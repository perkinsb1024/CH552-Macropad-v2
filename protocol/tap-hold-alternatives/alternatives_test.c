#include <assert.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "../src/actions.h"
#include "alternative_fixture.h"
static uint8_t reports[2048][9];
static unsigned count, ledCalls, cases;
static uint8_t blocked, generation, ledValue;
extern uint8_t buttonFirst[], buttonSecond[], buttonPressed[], pendingInput;
extern uint8_t liveBindings[], baseLayer, oneShotReturnLayer;
uint8_t USB_queueKeyboard(const uint8_t *keys) {
    if (blocked) return 0;
    assert(count < 2048); reports[count][0] = 1;
    memcpy(reports[count++] + 1, keys, 8); return 1;
}
uint8_t USB_queueMousePacked(uint8_t buttons, int8_t x, int8_t y, uint8_t scroll) {
    if (blocked) return 0;
    assert(count < 2048); uint8_t *r = reports[count++];
    r[0] = 2; r[1] = buttons; r[2] = x; r[3] = y; r[4] = scroll; return 1;
}
uint8_t USB_queueConsumer(uint16_t usage) {
    if (blocked) return 0;
    assert(count < 2048); reports[count][0] = 5;
    reports[count][1] = usage; reports[count++][2] = usage >> 8; return 1;
}
uint8_t USB_reportsPending(void) { return 0; }
void USB_discardReports(void) {}
uint8_t USB_reportGeneration(void) { return generation; }
uint8_t USB_asciiUsage(uint8_t c) { return c & 127; }
void firmwareLedAction(uint8_t command, uint8_t value) {
    (void)command; ledCalls++; ledValue = value;
}
static void start(void){count=ledCalls=blocked=0;memset(liveBindings,0,13);actionsInit();actionsTimedReset(0);}
static void pump(uint16_t now,unsigned duration){for(unsigned i=0;i<duration;i++)actionsPoll(now+i);}
static unsigned reportsWith(uint8_t kind,uint16_t value){unsigned n=0;for(unsigned i=0;i<count;i++){
 uint16_t u=kind==1?reports[i][3]:reports[i][1]|((uint16_t)reports[i][2]<<8);if(reports[i][0]==kind&&u==value)n++;}return n;}
static void ledAssignment(uint8_t input,uint8_t selector){thAssign(0,input,selector,0x1D,0,0x2D,0);}
static void testThresholds(void){
 const uint16_t origins[]={0,31,255,65500,65535};
 for(uint8_t input=0;input<=testKeys;input++)for(uint8_t selector=0;selector<(TAP_SPARSE?8:16);selector++)
 for(unsigned o=0;o<sizeof origins/sizeof origins[0];o++)for(int d=-1;d<=1;d++)for(uint8_t polling=0;polling<2;polling++){
  thInit(1,0,0);ledAssignment(input,selector);thFinish(0);assert(thValid());start();
  uint16_t origin=origins[o],threshold=thThreshold(0),release=origin+threshold+d;
  actionsPress(input,origin);assert(!ledCalls&&!liveBindings[12]);actionsPress(input,origin+1);
  if(polling){actionsPoll(origin+threshold-1);assert(!ledCalls);actionsPoll(release);}
  actionsRelease(input,release);assert(ledCalls==1&&ledValue==(d<0?1:2));
  assert(liveBindings[12]==1);pump(release,10);assert(ledCalls==1);cases++;
 }
}
static void testChords(void){
 for(uint8_t global=0;global<2;global++)for(uint8_t reverse=0;reverse<2;reverse++)
 for(uint8_t selector=0;selector<8;selector++)for(uint8_t interval=0;interval<=41;interval++){
  thInit(2,0,1);ledAssignment(0,selector);ledAssignment(1,selector);thFinish(0);
  uint8_t c=configLayerPaletteOffset(2);activeConfig[c]=global?0x70:0;
  activeConfig[c+1]=0x3D;activeConfig[c+2]=0;
  assert(thValid());start();uint8_t first=reverse?1:0,second=first^1;
  actionsPress(first,65000);actionsResolveInputs(65000+interval);actionsPress(second,65000+interval);
  if(interval<40){assert(ledCalls==1&&ledValue==3);actionsRelease(second,65050);actionsRelease(first,65051);assert(ledCalls==1);}
  else{
#if TAP_SINGLE
   // Expired/unmatched window allows promotion, but never steals a valid chord.
   assert(ledCalls==1&&ledValue==2);
#else
   if(thThreshold(0)>interval)assert(!ledCalls);
#endif
   actionsRelease(second,65000+interval+1);actionsRelease(first,65000+interval+2);
  }cases++;
 }
 // A short threshold must still respect the chord window.
 thInit(1,0,1);ledAssignment(0,0);thFinish(0);uint8_t c=configLayerPaletteOffset(1);
 activeConfig[c]=0x70;activeConfig[c+1]=0x3D;start();actionsPress(0,0);
 actionsPoll(31);assert(!ledCalls);actionsPress(1,39);assert(ledCalls==1&&ledValue==3);
 actionsRelease(1,40);actionsRelease(0,41);assert(ledCalls==1);
 // No matching chord: preferred design keeps independent taps; single-pending promotes.
 thInit(1,0,0);ledAssignment(0,7);ledAssignment(1,7);thFinish(0);start();
 actionsPress(0,0);actionsPress(1,1);
 assert(ledCalls==(TAP_SINGLE?1:0));actionsRelease(1,2);actionsRelease(0,3);
 assert(ledCalls==2);cases++;
}
static void testRotationAndPendingOverlap(void){
 thInit(1,0,1);ledAssignment(0,7);thFinish(0);uint8_t c=configLayerPaletteOffset(1);
 activeConfig[c]=0x70;activeConfig[c+1]=0x3D;start();actionsResolveInputs(100);actionsPress(0,100);
 actionsResolveInputs(110);actionsRotate(1);actionsPress(1,120);
 assert(ledCalls==1&&ledValue==3);actionsRelease(1,121);actionsRelease(0,122);assert(ledCalls==1);
 // Ordinary chord candidate first, dual-role encoder second: no pending state is lost.
 thInit(1,0,1);ledAssignment(testKeys,7);thFinish(0);c=configLayerPaletteOffset(1);
 activeConfig[c]=0x70;activeConfig[c+1]=0x3D;activeConfig[CONFIG_HEADER_SIZE]=0x4D;
 start();actionsPress(0,0);actionsPress(testKeys,1);actionsRelease(testKeys,2);actionsRelease(0,3);
 assert(ledCalls==2);cases+=2;
}
static void testLayersAndOutputs(void){
 thInit(2,0,0);thAssign(0,0,2,0x1D,0,CONFIG_ACTION_MOMENTARY_LAYER,1);thFinish(0);assert(thValid());start();
 uint16_t threshold=thThreshold(0);actionsPress(0,65500);actionsResolveInputs(65500+threshold);
 assert(actionsLayer()==1);actionsRelease(0,65501+threshold);assert(actionsLayer()==0&&!ledCalls);
 // Exact-threshold release must activate/release a layer even without a poll.
 start();actionsPress(0,0);actionsTakeLayerSelection();actionsRelease(0,threshold);
 assert(actionsLayer()==0&&actionsTakeLayerSelection());
 const uint8_t holds[]={2,0x34,9,0x6B};
 for(unsigned i=0;i<sizeof holds;i++){
  thInit(1,0,0);thAssign(0,0,2,1,5,holds[i],4);thFinish(0);assert(thValid());start();
  blocked=1;actionsPress(0,0);actionsRelease(0,thThreshold(0));pump(thThreshold(0),20);assert(!count);
  blocked=0;pump(thThreshold(0)+20,100);uint8_t kind=i==0?1:i==1?2:5;
  assert(reportsWith(kind,4)&&reportsWith(kind,0)&&!reportsWith(1,5));assert(!buttonPressed[0]);cases++;
 }
 // A pending key survives an unrelated layer change; snapshot selection remains captured.
 thInit(2,0,0);ledAssignment(0,7);thFinish(0);start();actionsPress(0,0);
 activeConfig[CONFIG_HEADER_SIZE+2]=CONFIG_ACTION_SET_LAYER;activeConfig[CONFIG_HEADER_SIZE+3]=1;
 actionsPress(1,1);actionsRelease(1,2);actionsRelease(0,3);
 assert(actionsLayer()==1&&ledCalls==1&&ledValue==(TAP_SINGLE?2:1));
 // Sparse encoding preserves an ordinary physical-hold tap without asserting it early.
#if TAP_SPARSE
 thInit(1,0,0);thAssign(0,0,2,0x12,4,0x2D,0);thFinish(0);assert(thValid());start();
 actionsPress(0,0);actionsPoll(1);assert(!reportsWith(1,4));
 actionsRelease(0,2);pump(2,40);assert(reportsWith(1,4)&&reportsWith(1,0));cases++;
#endif
 // Macro and text branches retain ordinary pool boundaries and output behavior.
 for(uint8_t hold=0;hold<2;hold++){
  thInit(1,0,0);thAssign(0,0,2,CONFIG_ACTION_MACRO,0,CONFIG_ACTION_MACRO,0);thFinish(0);
  thSetAction(0,0,CONFIG_ACTION_MACRO,macroStart);thSetAction(0,1,CONFIG_ACTION_MACRO,macroStart);
  activeConfig[macroStart]=1;activeConfig[macroStart+1]=4;assert(thValid());start();actionsPress(0,0);
  actionsRelease(0,hold?thThreshold(0):1);pump(1000,100);assert(reportsWith(1,4)==1);
 }
 thInit(2,0,0);activeConfig[CONFIG_HEADER_SIZE+testStride-1]&=15;
 thAssign(0,0,2,CONFIG_ACTION_STRING,0,CONFIG_ACTION_STRING,2);thFinish(4);memcpy(activeConfig+poolStart,"A\0B",4);
 assert(thValid());start();actionsPress(0,0);actionsRelease(0,1);pump(1,40);assert(reportsWith(1,'A')==1);
 actionsPress(0,50);actionsRelease(0,50+thThreshold(0));pump(1000,100);assert(reportsWith(1,'B')==1);
 thInit(1,0,0);ledAssignment(0,7);thFinish(0);start();actionsPress(0,0);actionsClear();actionsPoll(1000);actionsRelease(0,1000);assert(!ledCalls);
}
static void testModel(void){
 uint32_t random=0x12345678;uint8_t inputs=testKeys+1;
 for(unsigned trace=0;trace<1000;trace++){
  thInit(1,0,0);for(uint8_t i=0;i<inputs;i++)ledAssignment(i,trace&7);thFinish(0);start();
  uint8_t down[7]={0},waiting[7]={0},last=0;uint16_t since[7]={0},now=(uint16_t)random;unsigned expected=0;
  for(unsigned event=0;event<100;event++){
   random=random*1664525u+1013904223u;now+=(random>>24)&63;uint8_t key=(random>>8)%inputs,op=(random>>16)%3;
   if(op==0){
    if(!down[key]){
#if TAP_SINGLE
     for(uint8_t i=0;i<inputs;i++)if(waiting[i]){waiting[i]=0;last=2;expected++;}
#endif
     down[key]=waiting[key]=1;since[key]=now;
    }actionsPress(key,now);
   }else if(op==1){if(down[key]&&waiting[key]){last=(uint16_t)(now-since[key])>=thThreshold(key)?2:1;expected++;waiting[key]=0;}
    down[key]=0;actionsRelease(key,now);
   }else{for(uint8_t i=0;i<inputs;i++)if(waiting[i]&&(uint16_t)(now-since[i])>=thThreshold(i)){last=2;expected++;waiting[i]=0;}actionsPoll(now);}
   assert(ledCalls==expected&&(!expected||ledValue==last));cases++;
  }
 }
}
static void testValidation(void){
 for(uint8_t branch=0;branch<2;branch++){
  thInit(2,0,0);thAssign(0,0,2,0,0,0,0);thFinish(0);
  uint8_t ordinary=CONFIG_HEADER_SIZE+2*((branch||TAP_SPARSE)?1:testKeys+1);
  for(unsigned f=0;f<256;f++)for(unsigned s=0;s<256;s++){
   thSetAction(0,branch,0,0);activeConfig[ordinary]=f;activeConfig[ordinary+1]=s;
   uint8_t expected=thValid()&&(f&15)!=15;
   activeConfig[ordinary]=activeConfig[ordinary+1]=0;thSetAction(0,branch,f,s);
   assert(thValid()==expected);cases++;
  }
 }
#if TAP_SPARSE
 for(uint8_t layers=1;layers<=CONFIG_MAX_LAYERS;layers++){
  thInit(layers,0,0);ledAssignment(0,2);thFinish(0);
  for(unsigned id=0;id<256;id++){activeConfig[recordStart]=id;
   assert(thValid()==(TAP_LINEAR?id<layers*(testKeys+1):((id>>3)<layers&&(id&7)<=testKeys)));cases++;}
 }
 for(uint8_t n=0;n<32;n++){
  thInit(3,0,0);thFinish(0);activeConfig[CONFIG_HEADER_HOLDS]=n;
  uint8_t table=TAP_TAIL?128-3*n:sectionStart;
  for(uint8_t i=0;i<n&&table+3*i+2<128;i++)activeConfig[table+3*i]=TAP_LINEAR?i:((i/(testKeys+1))<<3)|(i%(testKeys+1));
  uint8_t expected=n<=3*(testKeys+1)&&sectionStart+3*n<=128;
  assert(thValid()==expected);cases++;
 }
#else
 thInit(2,0,1);ledAssignment(0,2);thFinish(0);uint8_t c=configLayerPaletteOffset(2);
 activeConfig[c]=0x70;activeConfig[c+1]=15;activeConfig[c+2]=recordStart;assert(!thValid());
 for(uint8_t aux=0;aux<16;aux++)for(unsigned address=0;address<256;address++){
  activeConfig[c+1]=0;activeConfig[c+2]=0;
  activeConfig[CONFIG_HEADER_SIZE]=(aux<<4)|15;activeConfig[CONFIG_HEADER_SIZE+1]=address;
  assert(thValid()==(address==recordStart));cases++;
 }
#endif
 // Macro references cannot point inside hold metadata.
 thInit(1,0,0);thAssign(0,0,2,CONFIG_ACTION_MACRO,0,0,0);thFinish(0);
 for(unsigned address=0;address<256;address++){thSetAction(0,0,CONFIG_ACTION_MACRO,address);
  assert(thValid()==(address>=macroStart&&address<(TAP_TAIL?recordStart:128)));cases++;}
#if TAP_TAIL
 thSetAction(0,0,CONFIG_ACTION_MACRO,recordStart-3);
 activeConfig[recordStart-3]=1;activeConfig[recordStart-2]=4;activeConfig[recordStart-1]=0;
 assert(thValid());activeConfig[recordStart-1]=1;assert(!thValid());activeConfig[recordStart-1]=0;cases+=2;
#endif
 thSetAction(0,0,0,0);assert(thValid());activeConfig[7]^=1;assert(!configValid(activeConfig,PHYSICAL_VARIANT));
}
int main(void){testThresholds();testChords();testRotationAndPendingOverlap();testLayersAndOutputs();testModel();testValidation();
 printf("Alternative sparse=%u single=%u fixed=%u board=%u: %u cases passed\n",TAP_SPARSE,TAP_SINGLE,TAP_FIXED,PHYSICAL_VARIANT,cases);return 0;}
