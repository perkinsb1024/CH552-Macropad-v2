#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "result_disk.h"
#include "tusb.h"

static uint8_t sense[3];
void tud_msc_set_sense(uint8_t l, uint8_t k, uint8_t a, uint8_t q) { (void)l; sense[0]=k; sense[1]=a; sense[2]=q; }
int main(void) {
  static uint8_t before[RESULT_BYTES], after[RESULT_BYTES], input[RESULT_BYTES];
  memset(input,0xa5,sizeof(input)); result_disk_init();
  assert(!result_drive_ready() && !tud_msc_test_unit_ready_cb(0));
  assert(sense[0]==2 && sense[1]==0x3a);
  assert(tud_msc_read10_cb(0,0,0,after,512)==-1);
  assert(!tud_msc_is_writable_cb(0));
  assert(result_disk_read(0,0,before,sizeof(before)));
  assert(tud_msc_write10_cb(0,0,0,input,sizeof(input))==-1);
  assert(result_disk_read(0,0,after,sizeof(after)) && !memcmp(before,after,sizeof(before)));
  assert(result_disk_add("EMPTY   BIN",NULL,0));
  assert(result_disk_add("FULL    BIN",input,121*512));
  assert(!result_disk_add("EXTRA   BIN",input,1));
  assert(!result_disk_add("INVALID BIN",input,SIZE_MAX));
  assert(!result_disk_read(128,0,after,1));
  assert(!result_disk_read(127,512,after,1));
  assert(!result_disk_read(127,511,after,2));
  assert(result_disk_read(127,511,after,1));
  result_drive_publish(); assert(tud_msc_test_unit_ready_cb(0));
  assert(tud_msc_read10_cb(0,127,511,after,1)==1 && after[0]==0xa5);
  assert(tud_msc_read10_cb(0,128,0,after,1)==-1 && sense[0]==5);
  assert(result_disk_read(0,0,before,sizeof(before)));
  for (unsigned lba=0;lba<=128;lba++) assert(tud_msc_write10_cb(0,lba,0,input,512)==-1);
  const uint8_t format[16]={0x04}, sync[16]={0x35};
  assert(tud_msc_scsi_cb(0,format,NULL,0)==-1); assert(tud_msc_scsi_cb(0,sync,NULL,0)==0);
  assert(result_disk_read(0,0,after,sizeof(after)) && !memcmp(before,after,sizeof(before)));
  puts("Disk tests passed: full-volume allocation, bounds, no-medium handling, write protection and SCSI format rejection");
}
