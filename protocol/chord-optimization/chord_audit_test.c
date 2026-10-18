/* Independent chord oracle and deterministic baseline/candidate state traces. */
#include <assert.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include "../src/actions.h"
#include "config_fixture.h"
#include "../src/live_state.h"

extern uint8_t liveBindings[], liveBindingLayer, buttonFirst[], buttonSecond[], buttonPressed[], buttonOrder[];
extern uint8_t inputDown, chordPartner[], pendingInput, pendingLayer;
extern uint16_t pendingSince;
void actionsWriteLive(void);
void actionsWriteTimers(void);
static uint64_t hash = UINT64_C(1469598103934665603);
static uint32_t randomState = 0x519A37C1;
static unsigned cases, reports;
static uint8_t blocked, transportPending, generation;
static uint16_t clockNow;
static const uint8_t keys = PHYSICAL_VARIANT ? 3 : 6;
static const uint8_t stride = PHYSICAL_VARIANT ? 15 : 22;
static void byte(uint8_t b) { hash = (hash ^ b) * UINT64_C(1099511628211); }
static void bytes(const uint8_t *p, unsigned n) { while (n--) byte(*p++); }
static uint32_t next(void) { randomState ^= randomState << 13; randomState ^= randomState >> 17; randomState ^= randomState << 5; return randomState; }
uint8_t USB_queueKeyboard(const uint8_t *p) {
    if (blocked) return 0;
    byte(1); byte(clockNow); byte(clockNow >> 8); bytes(p,8); reports++; return 1;
}
uint8_t USB_queueMousePacked(uint8_t buttons, int8_t x, int8_t y, uint8_t scroll) {
    if (blocked) return 0;
    byte(2); byte(clockNow); byte(clockNow >> 8); byte(buttons); byte(x); byte(y); byte(scroll); reports++; return 1;
}
uint8_t USB_queueConsumer(uint16_t usage) {
    if (blocked) return 0;
    byte(5); byte(clockNow); byte(clockNow >> 8); byte(usage); byte(usage >> 8); reports++; return 1;
}
uint8_t USB_reportsPending(void) { return transportPending; }
void USB_discardReports(void) { byte(0xD0); }
uint8_t USB_reportGeneration(void) { return generation; }
uint8_t USB_asciiUsage(uint8_t c) { return c == 'A' ? 0x84 : 4; }
void firmwareLedAction(uint8_t command, uint8_t value) { byte(0xD); byte(command); byte(value); byte(actionsLayer()); }
static void seal(void) { uint16_t crc=configCrc(activeConfig);activeConfig[7]=crc;activeConfig[8]=crc>>8; }
static uint8_t pairMask(unsigned index) {
    unsigned p=0;
    for (unsigned a=0;a<keys;a++) for (unsigned b=a+1;b<keys;b++,p++)
        if (index==p) return (1u<<a)|(1u<<b);
    assert(0); return 0;
}
static uint8_t expected(uint8_t layer,uint8_t inputs) {
    unsigned offset=configLayerPaletteOffset(configLayerCount());
    unsigned count=activeConfig[4]>>3;
    for (unsigned i=0;i<count;i++,offset+=3) {
        uint8_t id=activeConfig[offset];
        if ((id>>4)!=layer&&(id>>4)!=7) continue;
        if ((pairMask(id&15)&inputs)==inputs) return offset+1;
    }
    return 0;
}
static uint8_t actual(uint8_t layer,uint8_t inputs) {
#if CONFIG_CHORD_MASK_LOOKUP
    return configChordOffset(layer,inputs);
#else
    uint8_t first=0,second=0;
    for(uint8_t a=0;a<keys;a++)if(inputs&(1u<<a))for(uint8_t b=0;b<keys;b++)if(a!=b){
        if((inputs&(inputs-1))&&(uint8_t)((1u<<a)|(1u<<b))!=inputs)continue;
#if CONFIG_CHORD_PAIR_OFFSET
        if(configChordOffset(layer,a,b))return expected(layer,inputs);
#else
        if(configChord(layer,a,b,&first,&second))return expected(layer,inputs);
#endif
    }
    return 0;
#endif
}
static void profile(uint8_t layers,uint8_t timers,uint8_t chords,uint8_t custom) {
    memset(activeConfig,0,CONFIG_ACTIVE_SIZE);activeConfig[0]=CONFIG_MARKER;activeConfig[1]=CONFIG_VERSION;
    testSetVariant(PHYSICAL_VARIANT);testSetLayout(layers,0,timers);testSetChordCount(chords);
    activeConfig[5]=next();activeConfig[6]=next()&31;
    for(uint8_t l=0;l<layers;l++)if(custom&(1u<<l))activeConfig[9+stride*(l+1)-1]&=15;
}
static void lookupMatrix(void) {
    for(uint8_t layers=1;layers<=CONFIG_MAX_LAYERS;layers++)for(uint8_t custom=0;custom<2;custom++){
        unsigned pairs=keys*(keys-1)/2;
        for(unsigned id=0;id<256;id++){
            profile(layers,0,1,custom?255:0);
            unsigned offset=configLayerPaletteOffset(layers);
            if(offset+3>128)continue;
            activeConfig[offset]=id;activeConfig[offset+1]=1;activeConfig[offset+2]=4;
            seal();uint8_t valid=((id>>4)<layers||(id>>4)==7)&&(id&15)<pairs;
            assert(!!configValid(activeConfig,PHYSICAL_VARIANT)==valid);cases++;
            if(!valid)continue;
            for(uint8_t layer=0;layer<layers;layer++)for(uint8_t mask=1;mask<(1u<<keys);mask++){
                if(__builtin_popcount(mask)>2)continue;
                assert(actual(layer,mask)==expected(layer,mask));cases++;
            }
        }
        // Every possible pair of identifiers, with strict ordering and boundaries.
        profile(layers,0,2,custom?255:0);unsigned offset=configLayerPaletteOffset(layers);
        if(offset+6>128)continue;
        activeConfig[offset+1]=activeConfig[offset+4]=1;
        activeConfig[offset+2]=activeConfig[offset+5]=4;
        for(unsigned a=0;a<256;a++)for(unsigned b=0;b<256;b++){
            activeConfig[offset]=a;activeConfig[offset+3]=b;seal();
            unsigned valid=((a>>4)<layers||(a>>4)==7)&&(a&15)<pairs&&
                ((b>>4)<layers||(b>>4)==7)&&(b&15)<pairs&&a<b;
            assert(!!configValid(activeConfig,PHYSICAL_VARIANT)==valid);cases++;
        }
    }
}
static void snapshot(void) {
    byte(actionsLayer());byte(inputDown);byte(pendingInput);
    if(pendingInput){byte(pendingLayer);byte(pendingSince);byte(pendingSince>>8);}
    bytes(buttonFirst,7);bytes(buttonSecond,7);bytes(buttonPressed,7);bytes(buttonOrder,7);bytes(chordPartner,6);
    bytes(liveBindings,13);byte(liveBindingLayer);
    actionsWriteLive();bytes(liveReply,14);actionsWriteTimers();bytes(liveReply,18);
    byte(actionsDropped(0));byte(actionsDropped(1));byte(actionsTakeLayerSelection());
    cases++;
}
static void action(unsigned offset,uint8_t layers,unsigned macros,unsigned strings,uint8_t rotation) {
    static const uint8_t firsts[]={0,1,0x12,3,4,0x14,0x24,0x34,5,0x45,6,0x16,7,0x17,8,9,0x6A,0x6B,0xC,0x1C,0x2C,0x4C,0x6C,0xD,0xE,0x20};
    uint8_t first=firsts[next()%(sizeof firsts)],second=4+(next()%40);
    if(rotation&&(first==0x12||first==0x34||first==0x45||first==0x16||first==0x17||first==9||first==0x6B||first==0x2C||first==0x6C))first=1;
    if((first&15)==0xC)second=(first&0x40)?(uint8_t)(next()%7-3):next()%layers;
    if(first==0xD){first|=(next()%4)<<4;second=0;}
    if(first==0xE)second=macros;
    if(first==0x20)second=strings?0:0;
    activeConfig[offset]=first;activeConfig[offset+1]=second;
}
static void traces(void) {
    for(unsigned trace=0;trace<1600;trace++){
        unsigned layers=1+next()%3,timers=next()%3;
        unsigned palettes=(trace%3==0)?layers*((keys+1)/2):0;
        unsigned capacity=(128-9-stride*layers-palettes-6*timers-6)/3;
        unsigned chords=next()%(capacity+1);
        unsigned pairs=keys*(keys-1)/2;if(chords>pairs*(layers+1))chords=pairs*(layers+1);
        profile(layers,timers,chords,palettes?255:0);testSetStringLength(2);
        unsigned start=configLayerPaletteOffset(layers),strings=start+3*chords+6*timers,macros=strings+2;
        assert(macros+4<=128);activeConfig[strings]='A';activeConfig[strings+1]=0;
        activeConfig[macros]=1;activeConfig[macros+1]=4;activeConfig[macros+2]=0;
        for(unsigned l=0;l<layers;l++)for(unsigned i=0;i<keys+3;i++)action(9+stride*l+2*i,layers,macros,strings,i>keys);
        unsigned selected[120]={0};
        for(unsigned c=0;c<chords;c++){unsigned id;do{id=next()%(pairs*(layers+1));}while(selected[id]);selected[id]=1;}
        unsigned c=0;
        for(unsigned id=0;id<pairs*(layers+1);id++)if(selected[id]){
            unsigned offset=start+3*c++;activeConfig[offset]=((id/pairs==layers?7:id/pairs)<<4)|(id%pairs);
            action(offset+1,layers,macros,strings,0);
        }
        for(unsigned t=0;t<timers;t++){
            unsigned offset=start+3*chords+6*t;activeConfig[offset]=next()%4;
            activeConfig[offset+1]=0x1D;activeConfig[offset+2]=0;
            activeConfig[offset+3]=0x2D;activeConfig[offset+4]=0;
            activeConfig[offset+5]=(next()&0xC0)|(next()%(layers+1));
        }
        seal();assert(configValid(activeConfig,PHYSICAL_VARIANT));
        memset(liveBindings,0,13);liveBindingLayer=0;blocked=transportPending=generation=0;
        clockNow=trace%2?65510:next();actionsInit();actionsTimedReset(clockNow>>4);
        for(unsigned event=0;event<700;event++){
            clockNow+=next()%101;unsigned op=next()%18,key=next()%(keys+1);
            if(op<5)actionsPress(key,clockNow);
            else if(op<10)actionsRelease(key);
            else if(op==10)actionsRotate(next()&1);
            else if(op==11)blocked=next()&1;
            else if(op==12)transportPending=next()&1;
            else if(op==13)generation++;
            else if(op==14)actionsTimedPoll(clockNow>>4);
            else if(op==15){if(!actionsTimedInput())actionsPress(key,clockNow);}
            else if(op==16&&event%17==0)actionsClear();
            else actionsPoll(clockNow);
            snapshot();
        }
        blocked=transportPending=0;for(unsigned k=0;k<=keys;k++)actionsRelease(k);
        for(unsigned i=0;i<100;i++){clockNow++;actionsPoll(clockNow);snapshot();}
    }
}
int main(void) {
    lookupMatrix();traces();
    printf("board=%u cases=%u reports=%u trace=%016" PRIx64 "\n",PHYSICAL_VARIANT,cases,reports,hash);
    return 0;
}
