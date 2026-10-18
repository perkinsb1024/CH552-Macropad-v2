/* Independent decisions, shared pair records, exhaustive count bounds and mode safety. */
static void testExclusiveMode(void) {
 thInit(1,0,0);thFinish(0);assert(thValid());
 activeConfig[CONFIG_HEADER_POOL]^=1;thSeal();assert(!configValid(activeConfig,PHYSICAL_VARIANT));cases++;
 activeConfig[CONFIG_HEADER_POOL]^=1;assert(thValid());
 for(uint8_t layers=1;layers<=CONFIG_MAX_LAYERS;layers++)for(uint8_t n=0;n<32;n++){
  thInit(layers,0,0);thFinish(0);
  uint8_t begin=sectionStart;
#ifdef TEST_HEADER_COUNT
  activeConfig[CONFIG_HEADER_COUNTS]=n<<3;
  unsigned end=begin+4*n;
#else
  if(n)activeConfig[begin]=((n-1)<<4)|15;
  unsigned end=begin+(n?1+4*n:0);
#endif
  unsigned expected=end<=128;
#ifndef TEST_HEADER_COUNT
  if(n>16)continue;
#endif
  assert(thValid()==expected);cases++;
 }
 // All physical inputs can be pending; no new press or rotation promotes them.
 thInit(1,0,0);for(uint8_t i=0;i<=testKeys;i++)ledAssignment(i,7);thFinish(0);assert(thValid());start();
 for(uint8_t i=0;i<=testKeys;i++)actionsPress(i,65500+i);
 actionsRotate(1);actionsPoll(65510);assert(!ledCalls);
 for(uint8_t i=0;i<=testKeys;i++)actionsRelease(i,65520+i);
 assert(ledCalls==testKeys+1&&ledValue==1);cases++;
 // Multiple simultaneous holds resolve once and are released independently.
 start();for(uint8_t i=0;i<=testKeys;i++)actionsPress(i,65000);
 actionsPoll(65000+thThreshold(0));assert(ledCalls==testKeys+1&&ledValue==2);
 for(uint8_t i=0;i<=testKeys;i++)actionsRelease(i,65001+thThreshold(i));
 assert(ledCalls==testKeys+1);cases++;
 // Sharing a pair consumes four bytes regardless of the number of references.
 thInit(1,0,0);ledAssignment(0,7);thFinish(0);
 for(uint8_t i=1;i<=testKeys;i++){
  activeConfig[CONFIG_HEADER_SIZE+2*i]=activeConfig[CONFIG_HEADER_SIZE];
  activeConfig[CONFIG_HEADER_SIZE+2*i+1]=recordStart;
 }
 assert(thValid());start();for(uint8_t i=0;i<=testKeys;i++){actionsPress(i,0);actionsRelease(i,1);}
 assert(ledCalls==testKeys+1);cases++;
 // Neither tap nor hold may recursively invoke a wrapper.
 for(uint8_t hold=0;hold<2;hold++){
  thSetAction(0,hold,15,recordStart);assert(!thValid());thSetAction(0,hold,0,0);cases++;
 }
 // An unrelated input can consume a one-shot while this input is still waiting.
 thInit(2,0,0);thAssign(1,0,7,0x1D,0,0x2D,0);thFinish(0);
 activeConfig[CONFIG_HEADER_SIZE+2]=0x1C;activeConfig[CONFIG_HEADER_SIZE+3]=1;
 activeConfig[CONFIG_HEADER_SIZE+testStride+4]=0x3D;
 assert(thValid());start();actionsPress(1,0);actionsRelease(1,1);assert(actionsLayer()==1);
 actionsPress(0,2);assert(actionsLayer()==1&&oneShotReturnLayer==0);
 actionsPress(2,3);actionsRelease(2,4);assert(actionsLayer()==0&&oneShotReturnLayer==255);
 actionsRelease(0,5);assert(ledCalls==2&&ledValue==1);cases++;
}
