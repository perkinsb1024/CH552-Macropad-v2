/* Real scanner, sleep renderer, storage and protocol; hardware stubs only. */
#include <stdio.h>
#define TEST_REAL_PROTOCOL 1
#include "../src/protocol_firmware.h"
#define main inputRegressionMain
#include "input_test.c"
#undef main
#include "alternative_fixture.h"
extern uint8_t liveBindings[],timedHigh[],baseLayer;
static unsigned cases,flashWrites;
void eeprom_write_byte(uint8_t offset,uint8_t value){flash[offset]=value;flashWrites++;}
static void load(void){
 assert(thValid());memcpy(flash,activeConfig,128);protocolInit();firmwareApplyConfig(1);
 frameCount=flashWrites=0;memset(liveBindings,0,13);
}
static void initTap(uint8_t timers,uint8_t input,uint8_t chords){
 initAutoSleep();thInit(2,timers,chords);activeConfig[CONFIG_HEADER_SLEEP]=CONFIG_SLEEP_CONSUME;
 for(uint8_t l=0;l<2;l++)activeConfig[CONFIG_HEADER_SIZE+testStride*(l+1)-1]=0x1F;
 thAssign(0,input,2,0x1D,CONFIG_LED_PHASE_SET,CONFIG_ACTION_MOMENTARY_LAYER,1);thFinish(0);
 activeConfig[CONFIG_HEADER_SIZE+testStride+2]=0x2D;activeConfig[CONFIG_HEADER_SIZE+testStride+3]=CONFIG_LED_PHASE_SET;
 if(chords){uint8_t c=configLayerPaletteOffset(2);activeConfig[c]=0x70;activeConfig[c+1]=0x3D;activeConfig[c+2]=CONFIG_LED_PHASE_SET;}
 load();
}
static void pin(uint8_t input,uint8_t down){
 if(input==NUM_LEDS){if(down)P3&=~8;else P3|=8;}
 else if(input==5){if(down)P3&=~4;else P3|=4;}
 else{if(down)P1&=~KEY_MASK[input];else P1|=KEY_MASK[input];}
}
static uint16_t edge(uint8_t input,uint8_t down,uint16_t start){
 currentMs=start;pin(input,down);scanButton(input,currentMs);currentMs+=DEBOUNCE_MS;scanButton(input,currentMs);return currentMs;
}
static void testScan(void){
 for(uint8_t input=0;input<=NUM_LEDS;input++){
  initTap(0,input,0);uint16_t origin=edge(input,1,65520),threshold=thThreshold(0);
  assert(!liveBindings[12]);edge(input,0,origin+1);assert(ledSettings[0]==1&&liveBindings[12]==1&&actionsLayer()==0);cases++;
  initTap(0,input,0);origin=edge(input,1,65520);actionsTakeLayerSelection();edge(input,0,origin+threshold-DEBOUNCE_MS);
  assert(actionsLayer()==0&&actionsTakeLayerSelection()&&liveBindings[12]==1&&liveBindings[10]==CONFIG_ACTION_MOMENTARY_LAYER);cases++;
 }
 initTap(0,0,0);uint16_t origin=edge(0,1,100),threshold=thThreshold(0);
 currentMs=origin+threshold-DEBOUNCE_MS;pin(1,1);loop();currentMs=origin+threshold;loop();
 assert(actionsLayer()==1&&ledSettings[0]==2);edge(0,0,currentMs+1);assert(actionsLayer()==0&&!flashWrites);cases++;
 // Both orders of the user's button-1 hold / button-1+2 chord example.
 for(uint8_t reverse=0;reverse<2;reverse++){
  initTap(0,0,1);uint8_t first=reverse?1:0,second=first^1;origin=edge(first,1,65520);
  edge(second,1,origin+1);assert(ledSettings[0]==3&&liveBindings[12]==1&&actionsLayer()==0);
  currentMs+=thThreshold(0)+1;loop();assert(liveBindings[12]==1&&actionsLayer()==0);
  edge(second,0,currentMs+1);edge(first,0,currentMs+1);assert(liveBindings[12]==1&&actionsLayer()==0&&!flashWrites);cases++;
 }
}
static void testWakeTimersReset(void){
 for(uint8_t settings=0;settings<32;settings++)for(uint8_t encoder=0;encoder<2;encoder++){
  uint8_t key=encoder?NUM_LEDS:0;initTap(0,key,0);activeConfig[CONFIG_HEADER_SLEEP]=settings;actionsTimedReset(0);
  firmwareLedAction(LED_SLEEP_CAPTURE,activeConfig[CONFIG_SIZE+1]>>4);timedHigh[0]=1;
  uint16_t origin=edge(key,1,10);assert(!sleepBrightnessPending);unsigned before=liveBindings[12];
  currentMs=origin+thThreshold(0);loop();edge(key,0,currentMs+1);
  assert(liveBindings[12]==before+!(settings&CONFIG_SLEEP_CONSUME));assert(actionsLayer()==0&&!flashWrites);cases++;
 }
 for(uint8_t mask=0;mask<32;mask++){
  initTap(5,0,0);uint8_t t=configTimedOffset();for(uint8_t i=0;i<5;i++,t+=6){
   activeConfig[t+3]=0x1D;activeConfig[t+4]=CONFIG_LED_SPEED_RELATIVE;activeConfig[t+5]=128|((mask&(1<<i))?64:0);timedHigh[i]=1;
  }
  uint16_t origin=edge(0,1,10);assert(liveBindings[12]==5);currentMs=origin+thThreshold(0);actionsPoll(currentMs);edge(0,0,currentMs+1);
  assert(liveBindings[12]==(mask?5:6)&&actionsLayer()==0&&!flashWrites);cases++;
 }
 initTap(0,0,0);uint16_t origin=edge(0,1,10);protocolReset();currentMs=origin+1;protocolPoll(currentMs);
 unsigned before=liveBindings[12];currentMs=origin+1000;loop();edge(0,0,currentMs+1);assert(liveBindings[12]==before&&actionsLayer()==0&&!flashWrites);cases++;
}
#ifdef TAP_COMBINED
static void hostLayer(uint8_t options){uint8_t packet[32]={3,'U','M',1,13,42};packet[6]=options;
 assert(protocolReceive(packet));protocolPoll(currentMs);assert(protocolReply[8]==0&&!protocolState);}
static void testHost(void){
 initTap(0,0,0);uint16_t origin=edge(0,1,10);hostLayer(1);assert(actionsLayer()==1);edge(0,0,origin+1);
 assert(actionsLayer()==1&&ledSettings[0]==1);
 initTap(0,0,0);origin=edge(0,1,10);currentMs=origin+thThreshold(0);loop();assert(actionsLayer()==1);hostLayer(0);
 assert(actionsLayer()==1);edge(0,0,currentMs+1);assert(actionsLayer()==0&&!flashWrites);cases+=2;
}
#endif
int main(void){testScan();testWakeTimersReset();
#ifdef TAP_COMBINED
 testHost();
#endif
 printf("Alternative real scanner sparse=%u single=%u board=%u: %u cases passed\n",TAP_SPARSE,TAP_SINGLE,PHYSICAL_VARIANT,cases);return 0;}
