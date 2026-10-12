#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "reader.h"
#include "fixtures.h"

static void identified(reader_t *r) {
  reader_init(r); reader_reply(r, detect_reply, sizeof(detect_reply)); assert(r->identified);
}
static void configured(reader_t *r) {
  identified(r); reader_reply(r, config_reply, sizeof(config_reply)); assert(r->config_valid);
}
static void finish_data(reader_t *r) {
  uint8_t reply[64];
  for (unsigned i=0;i<3;i++) {
    unsigned count=i==2?12:58;
    data_response(reply, i*58, count); reader_reply(r,reply,count+6);
  }
}
int main(int argc, char **argv) {
  reader_t r; uint8_t tx[64], reply[64]; char report[2048];
  reader_init(&r);
  const uint8_t commands[]={0xa1,0xa7,0xab,0xab,0xab};
  for (unsigned step=0;step<5;step++) {
    size_t n=reader_request(&r,tx);
    assert(n && tx[0]==commands[step]);
    if (!step) reader_reply(&r,detect_reply,sizeof(detect_reply));
    else if (step==1) reader_reply(&r,config_reply,sizeof(config_reply));
    else {
      unsigned offset=tx[3], count=tx[7];
      assert(n==9 && tx[1]==6 && !tx[2] && !tx[4] && !tx[5] && !tx[6] && !tx[8]);
      assert(offset==(step-2)*58 && count==(step==4?12:58));
      data_response(reply,offset,count); reader_reply(&r,reply,count+6);
    }
  }
  assert(reader_complete(&r) && !reader_request(&r,tx));
  assert(r.global_config==0x7dff52ff && !(r.global_config&0x8000));
  for (unsigned i=0;i<128;i++) assert(r.data[i]==(uint8_t)(i^0xa5));
  size_t n=reader_report(&r,"test",report,sizeof(report)); assert(n && n==strlen(report));
  assert(strstr(report,"\"code_protect_bit\":0"));
  assert(strstr(report,"\"external_code_read_allowed\":false"));
  assert(!reader_report(&r,"test",report,16));
  assert(reader_report(&r,"test",report,sizeof(report)));
  if (argc==2) { FILE *f=fopen(argv[1],"wb"); assert(f); fwrite(report,1,strlen(report),f); fclose(f); }

  // An asserted protection bit must be decoded with the datasheet's polarity.
  identified(&r); uint8_t changed[sizeof(config_reply)]; memcpy(changed,config_reply,sizeof(changed));
  changed[15]|=0x80; reader_reply(&r,changed,sizeof(changed)); finish_data(&r);
  assert(reader_complete(&r)); reader_report(&r,"test",report,sizeof(report));
  assert(strstr(report,"\"code_protect_bit\":1") && strstr(report,"\"external_code_read_allowed\":true"));

  // Preserve configuration failure, but allow DataFlash independently of A7.
  identified(&r); reader_reply(&r,config_reply,8); finish_data(&r);
  assert(r.finished && r.data_len==128 && !r.config_valid && !reader_complete(&r));
  reader_report(&r,"test",report,sizeof(report)); assert(strstr(report,"\"code_protect_bit\":null"));
  identified(&r); changed[19]=3; reader_reply(&r,changed,sizeof(changed));
  assert(r.finished && !reader_request(&r,tx));

  // Unsupported DataFlash and partial snapshots must not look like success.
  configured(&r); uint8_t rejected[]={0xab,0x9d,2,0,0xfe,0}; reader_reply(&r,rejected,6);
  assert(r.finished && r.data_status==0xfe && !r.data_len && r.data_status_valid);
  assert(!reader_request(&r,tx));
  configured(&r); data_response(reply,0,58); reader_reply(&r,reply,64);
  reader_fail(&r,"timeout"); reader_t frozen=r; reader_reply(&r,reply,64);
  assert(!memcmp(&r,&frozen,sizeof(r)) && r.data_len==58 && !reader_complete(&r));

  // Exhaustive truncations and malformed length/status/opcode boundaries.
  for (size_t len=0;len<6;len++) { reader_init(&r); reader_reply(&r,detect_reply,len); assert(r.finished&&!r.identified); }
  for (size_t len=0;len<64;len++) { configured(&r); data_response(reply,0,58); reader_reply(&r,reply,len); assert(r.finished&&!r.data_len); }
  for (unsigned i=0;i<6;i++) {
    configured(&r); data_response(reply,0,58); reply[i]^=0xff;
    reader_reply(&r,reply,64);
    if (i==1) assert(r.data_len==58); // Header byte 1 is not the status.
    else assert(r.finished&&!r.data_len);
  }
  configured(&r); reader_reply(&r,reply,65); assert(r.finished);
  // Bounded deterministic fuzz under ASan/UBSan, including both parsers.
  uint32_t seed=12345;
  for (unsigned i=0;i<20000;i++) {
    for (unsigned j=0;j<64;j++) { seed=seed*1664525+1013904223; reply[j]=(uint8_t)(seed>>24); }
    size_t len=seed%65; reader_init(&r); if (i&1) identified(&r); if (i&2) configured(&r);
    reader_reply(&r,reply,len);
    probe_endpoints_t ep; probe_parse_interface(reply,len,&ep); probe_config_length(reply,len,512);
    size_t req=reader_request(&r,tx);
    assert(!req || tx[0]==0xa1 || tx[0]==0xa7 || tx[0]==0xab);
  }
  puts("Reader tests passed: real fixtures, protection polarity, full/partial DataFlash, malformed replies, read allowlist, fuzz");
}
