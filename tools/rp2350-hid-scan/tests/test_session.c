#include <assert.h>
#include <stdlib.h>
#define main scanner_main
#include "../firmware/main.c"
#undef main

static uint32_t fake_ms;
static bool pending, remove_queued, allow = true, reset_active, connected, flash_fail;
static uint16_t fake_vid = 0x1189, fake_pid = 0x8890;
static unsigned init_count, removals, attaches, probe_count, boot_commands;
static tuh_xfer_t transfer;
static tusb_control_request_t saved_setup;
static uint8_t fake_flash[2 * STORE_SLOT], led[3];
static const uint8_t report_descriptor[] = {0x06,0,0xff,0x09,1,0xa1,1,0x85,3,0x75,8,0x95,63,0x91,2,
  0x85,2,0x95,6,0x91,2,0xc0};
static uint8_t factory_interface[] = {9,4,1,0,1,3,0,0,0, 9,0x21,0x11,1,0,1,0x22,sizeof(report_descriptor),0,
  7,5,2,3,64,0,1};
static const uint8_t boot_interface[] = {9,4,0,0,2,0xff,0x80,0x55,0,
  7,5,0x82,2,64,0,0, 7,5,2,2,64,0,0};
static const uint8_t device[] = {18,1,0,2,0,0,0,64,0x89,0x11,0x90,0x88,0,0,0,0,0,1};
static const uint8_t configuration[] = {9,2,34,0,1,1,0,0x80,50,
  9,4,1,0,1,3,0,0,0, 9,0x21,0x11,1,0,1,0x22,sizeof(report_descriptor),0, 7,5,2,3,64,0,1};
absolute_time_t get_absolute_time(void) { return fake_ms; }
uint32_t to_ms_since_boot(absolute_time_t t) { return t; }
void tight_loop_contents(void) { fake_ms++; }
bool set_sys_clock_khz(unsigned c, bool r) { (void)c; (void)r; return true; }
void gpio_init(unsigned p) { (void)p; }
void gpio_disable_pulls(unsigned p) { (void)p; }
void gpio_set_dir(unsigned p, bool out) { (void)p; (void)out; }
bool gpio_get(unsigned p) { (void)p; return false; }
void panic(const char *s) { fprintf(stderr,"%s\n",s); abort(); }
void board_status_init(void) {}
void board_color(uint8_t r,uint8_t g,uint8_t b) { led[0]=r; led[1]=g; led[2]=b; }
bool board_boot_pressed(void) { return false; }
void tud_task_ext(uint32_t t,bool i) { (void)t; (void)i; }
void tuh_task_ext(uint32_t t,bool i) {
  (void)t; (void)i;
  if (remove_queued) {
    remove_queued=false; tuh_umount_cb(target); driver_close(target);
    pending=false; // Model TinyUSB removal closing endpoints and clearing control ownership.
  }
}
bool tud_cdc_connected(void) { return false; }
uint32_t tud_cdc_write(const void *p,uint32_t n) { (void)p; return n; }
void tud_cdc_write_flush(void) {}
uint32_t tud_cdc_available(void) { return 0; }
uint32_t tud_cdc_read(void *p,uint32_t n) { (void)p; (void)n; return 0; }
void tud_disconnect(void) { connected=false; }
void tud_connect(void) { connected=true; }
void tud_msc_set_sense(uint8_t l,uint8_t k,uint8_t a,uint8_t q) { (void)l; (void)k; (void)a; (void)q; }
bool tusb_init(uint8_t p,const tusb_rhport_init_t *i) { (void)i; if(p==1) init_count++; return true; }
bool tuh_configure(uint8_t p,unsigned i,const void *c) {
  (void)p; (void)i; assert(((const pio_usb_configuration_t *)c)->skip_alarm_pool); return true;
}
bool tuh_inited(void) { return host_started; }
bool tuh_rhport_reset_bus(uint8_t p,bool active) { assert(p==1); reset_active=active; return true; }
bool add_repeating_timer_us(int64_t d,bool (*cb)(repeating_timer_t *),void *arg,repeating_timer_t *t) {
  (void)cb; (void)arg; (void)t; assert(d==-1000 && !reset_active); return true;
}
bool cancel_repeating_timer(repeating_timer_t *t) { (void)t; return true; }
void pio_usb_host_frame(void) {}
void hcd_event_device_remove(unsigned p,bool i) { (void)i; assert(p==1); remove_queued=true; removals++; }
void hcd_event_device_attach(unsigned p,bool i) { (void)i; assert(p==1 && !pending && !remove_queued); attaches++; }
void tuh_vid_pid_get(uint8_t a,uint16_t *v,uint16_t *p) { (void)a; *v=fake_vid; *p=fake_pid; }
bool tuh_edpt_open(uint8_t a,const tusb_desc_endpoint_t *e) { (void)a; (void)e; return true; }
void usbh_driver_set_config_complete(uint8_t a,uint8_t i) { (void)a; (void)i; }
uint32_t save_and_disable_interrupts(void) { assert(state==DONE && !timer_started); return 0; }
void restore_interrupts(uint32_t i) { (void)i; }
void flash_range_erase(unsigned p,size_t n) {
  assert(p>=STORE_BASE && p+n<=STORE_BASE+sizeof(fake_flash) && !(p%4096) && n==4096);
  if(!flash_fail) memset(fake_flash+(p-STORE_BASE),0xff,n);
}
void flash_range_program(unsigned p,const uint8_t *data,size_t n) {
  assert(p>=STORE_BASE && p+n<=STORE_BASE+sizeof(fake_flash) && !(p%256) && n==256);
  if(!flash_fail) for(size_t j=0;j<n;j++) fake_flash[p-STORE_BASE+j]&=data[j];
}
static bool submit(tuh_xfer_t *xfer) {
  if(!allow) return false;
  assert(!pending); transfer=*xfer;
  if(xfer->setup) { saved_setup=*xfer->setup; transfer.setup=&saved_setup; transfer.buflen=saved_setup.wLength; }
  pending=true; return true;
}
bool tuh_control_xfer(tuh_xfer_t *xfer) {
  if(xfer->setup->bRequest==9) {
    assert(xfer->setup->bmRequestType==0x21 && xfer->setup->wIndex==1);
    assert(xfer->setup->wValue==(0x0200|initial_layout.reports[report_index].id));
    probe_count++;
  } else assert(xfer->setup->bRequest==6);
  return submit(xfer);
}
bool tuh_edpt_xfer(tuh_xfer_t *xfer) {
  if(xfer->ep_addr==2) {
    if(probe_usb_identity(fake_vid,fake_pid)) {
      assert(xfer->buflen==21 && xfer->buffer[0]==0xa1); boot_commands++;
    } else {
      assert(state==PROBE_OUT && !scan_skip(current_command));
      assert(xfer->buffer[0]==initial_layout.reports[report_index].id && xfer->buffer[1]==current_command);
      for(unsigned j=2;j<xfer->buflen;j++) assert(!xfer->buffer[j]);
      probe_count++;
    }
  }
  return submit(xfer);
}
static void reply(const void *data,size_t n,unsigned result) {
  assert(pending && n<=transfer.buflen);
  tuh_xfer_t done=transfer; pending=false;
  if(data && n) memcpy(done.buffer,data,n);
  done.actual_len=(uint32_t)n; done.result=result; done.complete_cb(&done);
}
static void reset_session(void) {
  fake_ms=0; state=IDLE; session=0; target=0;
  pending=remove_queued=reset_active=flash_fail=false; connected=allow=true;
  host_started=timer_started=reconnect_pending=published=factory_seen=checking=hit=boot_identity=scheduled_remove=false;
  result_pending=saved_results=false;
  report_index=cursor=attempts=accepted=rejected=dropped=input_count=0;
  dev_length=cfg_length=hid_length=boot_length=trace_length=console_offset=results_length=0;
  layout=(scan_layout_t){0}; initial_layout=(scan_layout_t){0}; out_ep=in_ep=0; outcome="not_run";
  fake_vid=0x1189; fake_pid=0x8890; init_count=removals=attaches=probe_count=boot_commands=0;
  factory_interface[4]=1; factory_interface[24]=2;
  memset(fake_flash,0xff,sizeof(fake_flash));
  static uint8_t restored[STORE_DISK]; assert(!store_load(&storage,fake_flash,restored));
  result_drive_hide();
}
static void startup(void) {
  arm(); assert(state==INSERT && reset_active && !timer_started && init_count==1);
  fake_ms=INSERT_MS-1; poll(); assert(state==INSERT);
  fake_ms++; poll(); assert(state==ENUMERATING && !reset_active && timer_started);
}
static void mount_factory(void) {
  assert(state==ENUMERATING && !target);
  assert(driver_open(1,1,(const tusb_desc_interface_t *)factory_interface,sizeof(factory_interface)));
  tuh_mount_cb(1); assert(state==DEVICE_DESC);
  reply(device,sizeof(device),0); reply(configuration,9,0); reply(configuration,sizeof(configuration),0);
  reply(report_descriptor,sizeof(report_descriptor),0);
}
static void complete_reenumeration(void) {
  assert(state==REMOVE_WAIT); fake_ms+=20; poll();
  assert(state==ENUMERATING && !target && !pending);
}
static void baseline(void) {
  startup(); mount_factory(); assert(state==REMOVE_WAIT && attempts==0);
  complete_reenumeration(); mount_factory(); assert(state==SEND_WAIT && attempts==0 && factory_seen);
}
static void send_probe(void) {
  fake_ms+=19; poll(); assert(!pending);
  fake_ms++; poll(); assert(state==PROBE_OUT && pending);
}
static void check_after_probe(void) {
  assert(state==OBSERVE); fake_ms+=999; poll(); assert(state==OBSERVE);
  fake_ms++; poll(); assert(state==REMOVE_WAIT); complete_reenumeration();
}
static void mount_boot(bool valid_reply) {
  fake_vid=0x4348; fake_pid=0x55e0;
  assert(driver_open(1,1,(const tusb_desc_interface_t *)boot_interface,sizeof(boot_interface)));
  tuh_mount_cb(1); assert(state==BOOT_WAIT);
  fake_ms+=20; poll(); assert(state==BOOT_OUT); reply(NULL,21,0);
  uint8_t a1[]={0xa1,0xb7,2,0,valid_reply?0x52:0x54,0x11}; reply(a1,sizeof(a1),0);
}
static void export(const char *path) {
  FILE *f=fopen(path,"wb"); assert(f); assert(fwrite(result_disk_image(),1,RESULT_BYTES,f)==RESULT_BYTES); fclose(f);
}
int main(int argc,char **argv) {
  // Full two-report sweep: 470 candidates, each separated by observation/reset
  // and a matching application descriptor. No skipped writes reach the transport.
  reset_session(); baseline();
  for(unsigned i=0;i<470;i++) {
    send_probe(); reply(NULL,tx_length,0); check_after_probe(); mount_factory();
    assert(state==SEND_WAIT);
  }
  fake_ms+=20; poll(); assert(state==DONE && !strcmp(outcome,"sweep_complete"));
  assert(attempts==470 && accepted==470 && !rejected && probe_count==470 && removals==471 && attaches==471);
  assert(saved_results && !hit && !dropped && !timer_started && led[0] && led[1]);
  assert(current_report_id==2);
  assert(result_drive_ready() && !connected);
  fake_ms+=350; poll(); assert(connected);
  unsigned before=probe_count; arm(); poll(); assert(probe_count==before && init_count==1);
  static uint8_t restored[STORE_DISK]; store_t loaded;
  assert(store_load(&loaded,fake_flash,restored) && !memcmp(restored,result_disk_image(),STORE_DISK));
  if(argc>1) export(argv[1]);

  reset_session(); baseline(); send_probe(); reply(NULL,tx_length,0); check_after_probe(); mount_boot(true);
  assert(hit && boot_identity && state==DONE && attempts==1 && boot_commands==1 && saved_results);
  assert(led[1] && !led[0]); if(argc>2) export(argv[2]);
  // Bootloader before candidates cannot be reported as a hit, including a
  // baseline reset that alone changes mode.
  reset_session(); startup(); mount_boot(true); assert(!hit && boot_identity && !attempts);
  reset_session(); startup(); mount_factory(); complete_reenumeration(); mount_boot(true);
  assert(!hit && boot_identity && !attempts && !strcmp(outcome,"bootloader_before_probe"));
  reset_session(); baseline(); send_probe(); reply(NULL,tx_length,0); check_after_probe(); mount_boot(false);
  assert(!hit && !boot_identity && !strcmp(outcome,"wch_identity_unconfirmed"));

  // Stalls and timeouts still get identity checks, and uncertain transfers are
  // never replayed. Late callbacks cannot mutate the next target session.
  reset_session(); baseline(); send_probe(); reply(NULL,0,XFER_RESULT_STALLED);
  assert(rejected==1 && !accepted); check_after_probe(); mount_factory(); send_probe();
  assert(current_command==19 && attempts==2);
  // Rejected reports remain fully represented in CSV even when repetitive
  // diagnostic logging is capped; there is no success inferred from a stall.
  reset_session(); baseline();
  for(unsigned i=0;i<470;i++) {
    send_probe(); reply(NULL,0,XFER_RESULT_STALLED); check_after_probe(); mount_factory();
  }
  fake_ms+=20; poll(); assert(state==DONE && rejected==470 && !accepted && !dropped && saved_results);
  reset_session(); baseline(); send_probe(); tuh_xfer_t late=transfer;
  fake_ms+=XFER_MS; poll(); assert(state==REMOVE_WAIT && rejected==1);
  late.actual_len=late.buflen; late.result=0; late.complete_cb(&late); assert(state==REMOVE_WAIT && !accepted);
  complete_reenumeration(); mount_factory(); send_probe(); assert(attempts==2 && current_command==19);
  finish("stopped_by_operator"); before=accepted; late.complete_cb(&late); assert(state==DONE && accepted==before);

  reset_session(); startup(); fake_vid=0x1209; fake_pid=0xc55d; tuh_mount_cb(1);
  assert(state==DONE && !attempts && saved_results);
  reset_session(); startup(); fake_ms+=ENUM_MS; poll(); assert(state==DONE && !attempts);
  reset_session(); baseline(); send_probe(); reply(NULL,tx_length,0); check_after_probe();
  fake_ms+=ENUM_MS; poll(); assert(state==DONE && attempts==1 && !hit);
  reset_session(); baseline(); allow=false; fake_ms+=20; poll(); assert(state==DONE && rejected==1);
  reset_session(); baseline(); send_probe(); reply(NULL,tx_length-1,0);
  assert(rejected==1 && !accepted); check_after_probe(); mount_factory(); assert(attempts==1);
  reset_session(); baseline(); send_probe(); tuh_umount_cb(1); driver_close(1); pending=false;
  assert(state==OBSERVE && !hit); check_after_probe(); mount_boot(true); assert(hit && last_result==-1);
  reset_session(); arm(); assert(reset_active && state==INSERT);
  finish("stopped_by_operator"); assert(!reset_active && saved_results);

  // Control fallback includes a report-ID byte in the data stage, like HIDAPI,
  // as well as the ID in wValue; no write to a keyboard interface is permitted.
  reset_session(); baseline(); out_ep=0; send_probe();
  assert(saved_setup.bRequest==9 && saved_setup.wLength==64 && tx[0]==3 && tx[1]==0);
  reply(NULL,tx_length,0); check_after_probe(); mount_boot(true); assert(hit);
  reset_session(); state=ENUMERATING; factory_interface[2]=0;
  assert(!driver_open(1,1,(const tusb_desc_interface_t *)factory_interface,sizeof(factory_interface)));
  factory_interface[2]=1;

  // A flash failure preserves RAM diagnostics and is visibly distinguished.
  reset_session(); baseline(); flash_fail=true; finish("stopped_by_operator");
  assert(!saved_results && result_drive_ready() && led[0] && !led[1]);
  assert(!store_load(&loaded,fake_flash,restored));
  // Wrapping deadlines do not dispatch early.
  reset_session(); baseline(); fake_ms=UINT32_MAX-5; deadline=fake_ms+20;
  poll(); assert(!pending); fake_ms+=19; poll(); assert(!pending); fake_ms++; poll(); assert(pending);
  puts("Session checks passed: 470-probe sweep, mode confirmation, baseline control, ownership, failures, flash export and restart limits");
}
