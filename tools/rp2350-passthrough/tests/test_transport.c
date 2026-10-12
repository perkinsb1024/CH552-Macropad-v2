#include <assert.h>
#include <stdlib.h>
#define main adapter_main
#include "../firmware/main.c"
#undef main
#include "fixtures.h"

static uint32_t fake_ms;
static bool accept=true, pending, host_ok, upstream_connected;
static unsigned out_count, host_init_count, device_connect_count;
static tuh_xfer_t transfer;
static uint8_t led[3];
absolute_time_t get_absolute_time(void) { return fake_ms; }
uint32_t to_ms_since_boot(absolute_time_t t) { return t; }
void tight_loop_contents(void) { fake_ms++; }
bool set_sys_clock_khz(unsigned c, bool r) { (void)c; (void)r; return true; }
void gpio_init(unsigned p) { (void)p; }
void gpio_disable_pulls(unsigned p) { (void)p; }
void gpio_set_dir(unsigned p, bool out) { (void)p; (void)out; }
bool gpio_get(unsigned p) { (void)p; return true; }
void panic(const char *msg) { fprintf(stderr,"%s\n",msg); abort(); }
void board_status_init(void) {}
void board_color(uint8_t r, uint8_t g, uint8_t b) { led[0]=r; led[1]=g; led[2]=b; }
bool board_boot_pressed(void) { return false; }
void tud_task_ext(uint32_t t, bool i) { (void)t; (void)i; }
void tuh_task_ext(uint32_t t, bool i) { (void)t; (void)i; }
bool tud_cdc_connected(void) { return false; }
uint32_t tud_cdc_write(const void *b, uint32_t n) { (void)b; return n; }
void tud_cdc_write_flush(void) {}
uint32_t tud_cdc_available(void) { return 0; }
uint32_t tud_cdc_read(void *b, uint32_t n) { (void)b; (void)n; return 0; }
void tud_disconnect(void) { upstream_connected=false; }
void tud_connect(void) { upstream_connected=true; device_connect_count++; }
void tud_msc_set_sense(uint8_t l, uint8_t k, uint8_t a, uint8_t q) { (void)l; (void)k; (void)a; (void)q; }
bool tusb_init(uint8_t p, const tusb_rhport_init_t *init) {
  (void)init; if (p==1) { host_init_count++; host_ok=true; } return true;
}
bool tuh_configure(uint8_t p, unsigned id, const void *cfg) { (void)p; (void)id; (void)cfg; return accept; }
bool tuh_inited(void) { return host_ok; }
void tuh_vid_pid_get(uint8_t addr, uint16_t *vid, uint16_t *pid) { (void)addr; *vid=0x4348; *pid=0x55e0; }
bool tuh_edpt_open(uint8_t addr, const tusb_desc_endpoint_t *ep) { (void)addr; (void)ep; return true; }
void usbh_driver_set_config_complete(uint8_t addr, uint8_t itf) { (void)addr; (void)itf; }
bool tuh_edpt_xfer(tuh_xfer_t *xfer) {
  if (!accept) return false;
  assert(!pending); transfer=*xfer; pending=true;
  if (!(xfer->ep_addr&0x80)) {
    // Independently check every actual downstream bulk OUT, including failures.
    assert(xfer->buffer[0]==0xa1 || xfer->buffer[0]==0xa7 || xfer->buffer[0]==0xab);
    if (xfer->buffer[0]==0xab) {
      assert(xfer->buflen==9 && xfer->buffer[1]==6 && !xfer->buffer[2]);
      assert(!xfer->buffer[4] && !xfer->buffer[5] && !xfer->buffer[6] && !xfer->buffer[8]);
      assert(xfer->buffer[3]+xfer->buffer[7]<=128);
    }
    out_count++;
  }
  return true;
}
static bool descriptor(uint8_t addr, void *data, uint16_t len, void (*cb)(tuh_xfer_t *)) {
  if (!accept) return false;
  assert(!pending); transfer=(tuh_xfer_t){.daddr=addr,.buffer=data,.buflen=len,.complete_cb=cb}; pending=true; return true;
}
bool tuh_descriptor_get_device(uint8_t a, void *d, uint16_t n, void (*cb)(tuh_xfer_t *), uintptr_t u) {
  (void)u; assert(n==18); return descriptor(a,d,n,cb);
}
bool tuh_descriptor_get_configuration(uint8_t a, uint8_t i, void *d, uint16_t n, void (*cb)(tuh_xfer_t *), uintptr_t u) {
  (void)i; (void)u; assert(n==9 || n==32); return descriptor(a,d,n,cb);
}
static void reply(const void *bytes, size_t len, unsigned result) {
  assert(pending && len<=transfer.buflen);
  tuh_xfer_t done=transfer; pending=false;
  if (bytes && len) memcpy(done.buffer,bytes,len);
  done.actual_len=(uint32_t)len; done.result=result; done.complete_cb(&done);
}
static void reset_session(void) {
  state=IDLE; target=0; endpoints=(probe_endpoints_t){0};
  host_started=reconnect_pending=published=false; host_ok=pending=false; accept=true;
  trace_len=console_read=device_desc_len=config_desc_len=0; dropped=0; out_count=host_init_count=device_connect_count=0;
  fake_ms=0; reader_init(&capture); result_disk_init(); upstream_connected=true;
}
static void enter(void) {
  arm(); assert(state==ARMED && led[1] && led[2]);
  fake_ms=ARM_MS-1; reader_poll(); assert(!host_init_count);
  fake_ms++; reader_poll(); assert(state==ENUMERATING && host_init_count==1);
  assert(driver_open(1,1,(const tusb_desc_interface_t *)(usb_config+9),sizeof(usb_config)-9));
  tuh_mount_cb(1); assert(state==DEVICE_DESC);
  const uint8_t device[]={18,1,0,2,0xff,0,0,64,0x48,0x43,0xe0,0x55,0,0,0,0,0,1};
  reply(device,18,0); reply(usb_config,9,0); reply(usb_config,32,0);
  assert(state==WAIT_REQUEST);
}
static void command_reply(const void *bytes, size_t len) {
  fake_ms+=GAP_MS-1; reader_poll(); assert(!pending);
  fake_ms++; reader_poll(); assert(state==BULK_OUT && pending);
  reply(NULL,tx_len,0); assert(state==BULK_IN); reply(bytes,len,0);
}
int main(int argc, char **argv) {
  reset_session(); assert(!tud_msc_test_unit_ready_cb(0)); enter();
  command_reply(detect_reply,6); command_reply(config_reply,sizeof(config_reply));
  uint8_t bytes[64];
  for (unsigned i=0;i<3;i++) { unsigned n=i==2?12:58; data_response(bytes,i*58,n); command_reply(bytes,n+6); }
  assert(state==FINISHED && reader_complete(&capture) && out_count==5);
  assert(led[0]==0 && led[1]>0 && led[2]==0 && result_drive_ready());
  assert(!upstream_connected && host_ok && host_init_count==1);
  fake_ms+=349; reader_poll(); assert(!upstream_connected);
  fake_ms++; reader_poll(); assert(upstream_connected && device_connect_count==1);
  arm(); reader_poll(); assert(state==FINISHED && out_count==5 && host_init_count==1);
  if (argc==2) {
    static uint8_t image[RESULT_BYTES]; assert(result_disk_read(0,0,image,sizeof(image)));
    FILE *f=fopen(argv[1],"wb"); assert(f); fwrite(image,1,sizeof(image),f); fclose(f);
  }
  // Write attempts never alter the disk, even while the reader is idle.
  static uint8_t before[RESULT_BYTES], after[RESULT_BYTES];
  assert(result_disk_read(0,0,before,sizeof(before)));
  assert(!tud_msc_is_writable_cb(0)); assert(tud_msc_write10_cb(0,0,0,bytes,64)==-1);
  assert(result_disk_read(0,0,after,sizeof(after)) && !memcmp(before,after,sizeof(before)));

  // Timeout with an outstanding IN: preserve buffers and ignore late callbacks.
  reset_session(); enter(); command_reply(detect_reply,6);
  fake_ms+=20; reader_poll(); reply(NULL,tx_len,0); assert(state==BULK_IN);
  tuh_xfer_t late=transfer; fake_ms+=XFER_MS; reader_poll();
  assert(state==FINISHED && capture.identified && !reader_complete(&capture) && led[0] && led[1]);
  unsigned count=out_count;
  reply(config_reply,sizeof(config_reply),0); late.complete_cb(&late);
  fake_ms+=20000; reader_poll(); assert(out_count==count && !capture.config_valid && host_init_count==1);
  reset_session(); enter(); driver_close(1);
  assert(state==FINISHED && !capture.identified && led[0] && !led[1]);
  reset_session(); arm(); fake_ms=ARM_MS; reader_poll(); fake_ms+=ENUM_MS; reader_poll();
  assert(state==FINISHED && !out_count && !capture.identified);
  reset_session(); enter(); accept=false; fake_ms+=GAP_MS; reader_poll();
  assert(state==FINISHED && !out_count);
  reset_session(); enter(); fake_ms+=GAP_MS; reader_poll(); reply(NULL,0,XFER_RESULT_FAILED);
  assert(state==FINISHED && out_count==1);
  reset_session(); enter(); uint8_t bad[]={0xa1,0x9d,2,0,0x54,0x11}; command_reply(bad,6);
  assert(state==FINISHED && out_count==1 && !capture.identified);
  // Deadline wraparound works before, during, and after command submissions.
  reset_session(); enter(); fake_ms=UINT32_MAX-5; queue_request();
  reader_poll(); assert(!pending); fake_ms+=19; reader_poll(); assert(!pending);
  fake_ms++; reader_poll(); assert(pending && state==BULK_OUT);
  puts("Transport tests passed: automatic capture, USB timing/reconnect, LED outcomes, timeout ownership, disconnects, write rejection");
}
