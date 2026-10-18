/* Shared semantic fixture for independently encoded prototypes. */
#ifndef TAP_HOLD_ALTERNATIVE_FIXTURE_H
#define TAP_HOLD_ALTERNATIVE_FIXTURE_H
#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../src/config.h"
#include "config_fixture.h"
#ifndef TAP_SPARSE
#define TAP_SPARSE 0
#endif
#ifndef TAP_SINGLE
#define TAP_SINGLE 0
#endif
#ifndef TAP_TAIL
#define TAP_TAIL 0
#endif
#ifndef TAP_LINEAR
#define TAP_LINEAR 0
#endif
#ifndef TAP_FIXED
#define TAP_FIXED 0
#endif
static const uint8_t testStride = PHYSICAL_VARIANT ? 15 : 22;
static const uint8_t testKeys = PHYSICAL_VARIANT ? 3 : 6;
typedef struct { uint8_t layer,input,selector,tf,ts,hf,hs; } ThAssignment;
static ThAssignment assignments[20];
static uint8_t assignmentCount, recordStart, macroStart, poolStart, sectionStart;
static void thInit(uint8_t layers, uint8_t timers, uint8_t chords) {
    memset(activeConfig,0,CONFIG_ACTIVE_SIZE);
    activeConfig[0]=CONFIG_MARKER;activeConfig[1]=CONFIG_VERSION;
    testSetVariant(PHYSICAL_VARIANT);testSetLayout(layers,0,timers);testSetChordCount(chords);
    activeConfig[CONFIG_HEADER_LED]=2;
    assignmentCount=0;
}
static void thAssign(uint8_t layer,uint8_t input,uint8_t selector,uint8_t tf,uint8_t ts,uint8_t hf,uint8_t hs) {
    assert(assignmentCount<20);
    assignments[assignmentCount++]=(ThAssignment){layer,input,selector,tf,ts,hf,hs};
}
static void thFinish(uint8_t strings) {
    sectionStart=configTimedOffset()+CONFIG_TIMED_SIZE*configTimedCount();
#if TAP_SPARSE
    activeConfig[CONFIG_HEADER_HOLDS]=assignmentCount | (assignmentCount ? assignments[0].selector<<5 : 0);
    recordStart=TAP_TAIL?128-3*assignmentCount:sectionStart;
    poolStart=TAP_TAIL?sectionStart:sectionStart+3*assignmentCount;
    macroStart=poolStart+strings;
#else
    poolStart=sectionStart;
    recordStart=poolStart+strings+(assignmentCount?1:0);
    if(assignmentCount)activeConfig[poolStart+strings]=((assignmentCount-1)<<4)|15;
    macroStart=recordStart+4*assignmentCount;
#endif
    testSetStringLength(strings);
    assert(macroStart<=128);
    for(uint8_t i=0;i<assignmentCount;i++) {
        ThAssignment a=assignments[i];
        uint8_t binding=CONFIG_HEADER_SIZE+testStride*a.layer+2*a.input;
#if TAP_SPARSE
        activeConfig[binding]=a.tf;activeConfig[binding+1]=a.ts;
        activeConfig[recordStart+3*i]=TAP_LINEAR?a.layer*(testKeys+1)+a.input:(a.layer<<3)|a.input;
        activeConfig[recordStart+3*i+1]=a.hf;activeConfig[recordStart+3*i+2]=a.hs;
#else
        activeConfig[binding]=(a.selector<<4)|15;activeConfig[binding+1]=recordStart+4*i;
        activeConfig[recordStart+4*i]=a.tf;activeConfig[recordStart+4*i+1]=a.ts;
        activeConfig[recordStart+4*i+2]=a.hf;activeConfig[recordStart+4*i+3]=a.hs;
#endif
    }
}
static void thSetAction(uint8_t assignment,uint8_t hold,uint8_t first,uint8_t second) {
    uint8_t offset;
#if TAP_SPARSE
    offset=hold?recordStart+3*assignment+1:
        CONFIG_HEADER_SIZE+testStride*assignments[assignment].layer+2*assignments[assignment].input;
#else
    offset=recordStart+4*assignment+2*hold;
#endif
    activeConfig[offset]=first;activeConfig[offset+1]=second;
}
static uint16_t thThreshold(uint8_t assignment) {
#if TAP_FIXED
    (void)assignment;return 200;
#elif TAP_SPARSE
    (void)assignment;return 128+64*(activeConfig[CONFIG_HEADER_HOLDS]>>5);
#else
    return 32*(assignments[assignment].selector+1);
#endif
}
static void thSeal(void) {
    uint16_t crc=configCrc(activeConfig);activeConfig[7]=crc;activeConfig[8]=crc>>8;
}
static uint8_t thValid(void) {thSeal();return !!configValid(activeConfig,PHYSICAL_VARIANT);}
#endif
