"""Full chords + independent tap-hold + optional-input HID layer command."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import difflib
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
ART=Path('/private/tmp/macropad-combined-feature-fit')
BASE_REVISION='18ae05b0c26811eb10c58c6825727f7e7abb8ee3'
spec=importlib.util.spec_from_file_location('prior',ROOT/'protocol/tap-hold-investigation/measure.py')
prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)
prior.HERE,prior.ART=HERE,ART
replace=prior.replace
HID='src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.c'
FILES=(*prior.FIRMWARE,'platformio.ini',HID,'src/userUsbHidKeyboardMouse/USBHIDKeyboardMouse.h','src/userUsbHidKeyboardMouse/USBhandler.c')


def blank(name):
    source=ART/name/'source'
    if source.exists():raise RuntimeError(f'Existing snapshot: {source}')
    source.mkdir(parents=True)
    template=ART/'baseline/source' if name!='baseline' and (ART/'baseline/source').exists() else ROOT
    for folder in ('src','tests','pio-platform'):shutil.copytree(template/folder,source/folder)
    for f in ('CH552_Universal_Macropad.ino','platformio.ini'):shutil.copyfile(template/f,source/f)
    (source/'webUploader').symlink_to(ROOT/'webUploader',target_is_directory=True)
    return source


def combined(source):
    replace(source,'src/config.h','#define CONFIG_ACTION_RESERVED         0xF',
        '#define CONFIG_ACTION_TAP_HOLD         0xF\n#define CONFIG_ACTION_RESERVED         0xF')
    replace(source,'src/config.h','#define CONFIG_ACTION_MASK (0xFFFFu ^ (1u << CONFIG_ACTION_RESERVED))',
        '#define CONFIG_ACTION_MASK 0xFFFFu')
    replace(source,'src/config.c','static const __xdata uint8_t *__data validationImage;',
        'static __data uint8_t validationMacros;\nstatic const __xdata uint8_t *__data validationImage;')
    replace(source,'src/config.c','__idata uint8_t macros = validationPool + validationUsed;',
        '__idata uint8_t macros = validationMacros;')
    replace(source,'src/config.c','        case CONFIG_ACTION_MACRO:',
        '''        case CONFIG_ACTION_TAP_HOLD:
            return !rotation && param > (uint8_t)(validationPool + validationUsed) && param < macros &&
                   !((param ^ macros) & 3);
        case CONFIG_ACTION_MACRO:''')
    replace(source,'src/config.c','    offset = 9;\n    for (layer',
        '''    // Optional counted pair block follows strings; ordinary profiles add nothing.
    validationMacros = (uint8_t)end;
    if (end < CONFIG_SIZE && (validationImage[(uint8_t)end] & 15) == CONFIG_ACTION_TAP_HOLD) {
        offset = (uint8_t)(5 + (uint8_t)((validationImage[(uint8_t)end] >> 4) << 2));
        // Both terms are <=128/65; the unsigned byte sum cannot wrap.
        validationMacros = (uint8_t)end + offset;
        if (validationMacros > CONFIG_SIZE) return 0;
    }
    offset = 9;
    for (layer''')
    replace(source,'src/config.c','''    for (offset = validationPool + validationUsed; offset < CONFIG_SIZE; offset++) {
        if (!validationImage[offset]) continue;
        if (offset == CONFIG_SIZE - 1 || !actionValid(offset, 2)) return 0;
        offset++;
    }''','''    offset = validationPool + validationUsed;
    if (offset < validationMacros) offset++; // Skip the optional prefix.
    for (; offset < CONFIG_SIZE; offset++) {
        if (offset < validationMacros) {
            if ((validationImage[offset] & 15) == CONFIG_ACTION_TAP_HOLD ||
                !actionValid(offset, !((offset ^ validationMacros) & 2))) return 0;
        } else {
            if (!validationImage[offset]) continue;
            if (offset == CONFIG_SIZE - 1 || !actionValid(offset, 2)) return 0;
        }
        offset++;
    }''')
    replace(source,'src/actions.c','__data uint16_t pendingSince;',
        '__data uint16_t pendingSince;\n__xdata uint16_t tapSince[PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 4 : 7];\n__idata uint16_t tapNow;')
    replace(source,'src/actions.c','static void updateLayer(void);',
        '''static void selectBaseLayer(uint8_t layer) {
  uint8_t previous = oneShotReturnLayer == 0xFF ? baseLayer : oneShotReturnLayer;
  if (layer != previous) previousLayer = previous;
  baseLayer = layer;
}

static void updateLayer(void);''')
    replace(source,'src/actions.c','  __xdata uint8_t requestedSecond = second;',
        '  // Waiting wrappers do not execute or consume a one-shot.\n'
        '  if (actionType(first) == CONFIG_ACTION_TAP_HOLD) return;\n'
        '  __xdata uint8_t requestedSecond = second;')
    replace(source,'src/actions.c','''      oneShotReturnLayer = baseLayer;
    } else {
      selectedLayer = oneShotReturnLayer == 0xFF ? baseLayer : oneShotReturnLayer;
      if (second != selectedLayer) previousLayer = selectedLayer;
    }
    baseLayer = second;''','''      oneShotReturnLayer = baseLayer;
      baseLayer = second;
    } else selectBaseLayer(second);''')
    replace(source,'src/actions.c','static void resolvePending(void) {',
        '''static FW_BIT tapExpired(uint8_t input) {
  uint16_t elapsed = tapNow - tapSince[input];
  return (elapsed >> 5) > (buttonFirst[input] >> 4);
}

static void resolveTap(uint8_t input, uint8_t branch) {
  uint8_t offset = buttonSecond[input] + branch;
  buttonFirst[input] = activeConfig[offset];
  buttonSecond[input] = activeConfig[(uint8_t)(offset + 1)];
  runAction(buttonFirst[input], buttonSecond[input], 0, input);
  updateLayer();
}

static void resolvePending(void) {''')
    replace(source,'src/actions.c','void actionsInit(void) {',
        '''void actionsSetLayer(uint8_t options) {
  if ((options & 0x80) && actionsTimedInput()) return;
  selectBaseLayer(options & 0x7F);
  // Replace a pending one-shot; physical layer holds retain priority.
  oneShotReturnLayer = 0xFF;
  layerSelectionPending = 1;
  updateLayer();
}

void actionsInit(void) {''')
    replace(source,'src/actions.c','  inputDown |= inputMask;',
        '  inputDown |= inputMask;\n  tapSince[input] = now;')
    replace(source,'src/actions.c','      pendingInput = 0;\n      chordPartner[other]',
        '      pendingInput = 0;\n      tapSince[other] = now; // Chord duration starts at recognition.\n      chordPartner[other]')
    replace(source,'src/actions.c','static void releaseAction(uint8_t input) {',
        'static void releaseAction(uint8_t input) {\n'
        '  if (buttonPressed[input] && actionType(buttonFirst[input]) == CONFIG_ACTION_TAP_HOLD)\n'
        '    resolveTap(input, tapExpired(input) ? 2 : 0);')
    for f in ('src/actions.c','src/actions.h'):
        replace(source,f,'void actionsRelease(uint8_t input)', 'void actionsRelease(uint8_t input, __xdata uint16_t now)')
    replace(source,'src/actions.c','void actionsRelease(uint8_t input, __xdata uint16_t now) {',
        'void actionsRelease(uint8_t input, __xdata uint16_t now) {\n  tapNow = now;')
    prior.normalize_before_scan(source)
    replace(source,'src/actions.c','''  i = USB_reportGeneration();''','''  i = USB_reportGeneration();''')
    replace(source,'src/actions.c','''    updateLayer();
  }
}

void actionsPoll(uint16_t now)''','''    updateLayer();
  }
  tapNow = now;
  // Resolve before output backpressure can postpone the decision.
  for (i = 0; i < MAX_INPUTS; i++) {
    if (buttonPressed[i] == 1 && actionType(buttonFirst[i]) == CONFIG_ACTION_TAP_HOLD && tapExpired(i))
      resolveTap(i, 2);
  }
}

void actionsPoll(uint16_t now)''')
    replace(source,'src/actions.h','uint8_t actionsLayer(void);',
        'uint8_t actionsLayer(void);\n// Target is validated by the protocol; bit 7 services normal input timers.\nvoid actionsSetLayer(uint8_t options);')
    replace(source,'CH552_Universal_Macropad.ino','actionsRelease(input);','actionsRelease(input, now);')
    subprocess.run(['git','apply','--unsafe-paths','--include=src/protocol_firmware.c',
        '--include=tests/hid_layer_test.c','--include=tests/input_layer_test.c',
        str(ROOT/'protocol/hid-layer-investigation/recommended.patch')],cwd=source,check=True)
    for p in (source/'tests').glob('*.[ch]'):
        s=p.read_text();s=re.sub(r'actionsRelease\(([^();,]+)\)',r'actionsRelease(\1, 0)',s)
        s=s.replace('sent[22] == 0x7F','sent[22] == 0xFF')
        s=s.replace('if (slot == 5) offset = pool + 4;', 'if (slot == 5) offset = pool + 5;')
        p.write_text(s)
    replace(source,'tests/protocol_test.c','uint8_t actionsLayer(void) { return configStartupLayer(); }',
        'uint8_t actionsLayer(void) { return configStartupLayer(); }\nvoid actionsSetLayer(uint8_t options) { (void)options; }')
    for name in ('tap_hold','tap_hold_integration'):
        shutil.copyfile(ROOT/'protocol/tap-hold-investigation'/(name+'_test.c'),source/'tests'/(name+'_test.c'))
    replace(source,'tests/run_host_tests.py','    for suite in suites:',
        '    suites += [("tap_hold", ["src/config.c", "src/actions.c"], variant) for variant in (0, 1)]\n'
        '    suites += [("tap_hold_integration", ["src/config.c", "src/actions.c", "src/storage.c", "src/protocol_firmware.c"], variant) for variant in (0, 1)]\n'
        '    suites += [("input_layer", ["src/config.c", "src/actions.c", "src/storage.c", "src/protocol_firmware.c"], variant) for variant in (0, 1)]\n'
        '    for suite in suites:')


def optimize(name,source):
    recipes={
        'hot-a':'binding-offset+load-helper+dispatch-helper+usb-data-queue+raw-pdata+callee-pending+callee-layers+callee-timed',
        'hot-b':'binding-offset+load-helper+dispatch-helper+usb-data-queue+usb-data-clocks+callee-pending+callee-layers+callee-timed',
        'hot-c':'binding-offset+load-helper+dispatch-helper+usb-data-queue+usb-data-idle+callee-pending+callee-layers+callee-timed',
        'hot-d':'binding-offset+load-helper+dispatch-helper+usb-data-queue+usb-data-idle+raw-pdata+callee-pending+callee-layers+callee-timed',
        'hot-e':'hot-d+stack',
        'hot-f':'hot-d+stack+binding-params',
        'hot-g':'hot-d+tap-external',
        'hot-h':'hot-d+tap-external+binding-params',
        'hot-i':'hot-g+callee-binding-offset',
        'hot-j':'hot-g+callee-loader',
        'hot-k':'hot-g+callee-dispatch',
        'hot-l':'hot-g+callee-expired',
        'hot-m':'hot-g+cold-state',
        'hot-n':'hot-g+validation-external',
        'hot-o':'hot-g+stable-external',
        'hot-p':'hot-g+wide-optional',
        'hot-q':'hot-g+stable-external+wide-optional',
        'hot-r':'hot-p+cold-state',
        'hot-s':'hot-p+cold-state+cool-rates',
        'hot-t':'hot-p+cold-state+cool-global',
        'hot-u':'hot-s+reuse-offset',
        'order-a':'hot-r+legacy-order',
        'order-b':'hot-p+legacy-order',
        'order-c':'hot-d+legacy-order',
        'order-d':'order-b+tap-comparison',
        'order-e':'order-a+tap-comparison',
        'order-f':'order-b+event-parallel',
        'order-g':'order-b+poll-mask',
        'order-h':'order-e+tap-index',
        'order-i':'order-h+poll-external',
        'order-j':'order-i+cool-global',
        'order-k':'order-h+poll-bit+event-parallel',
        'order-l':'order-d+poll-bit',
        'order-m':'order-k+metadata-subtraction',
    }
    if name in recipes:optimize(recipes[name],source)
    elif '+' in name:
        for part in name.split('+'):optimize(part,source)
    elif name=='binding-offset':
        replace(source,'src/config.h','void configBinding(uint8_t layer, uint8_t input, __data uint8_t *first, __data uint8_t *second);',
            '#define CONFIG_BINDING_OFFSET 1\n// Caller supplies a validated layer and binding input.\nuint8_t configBindingOffset(uint8_t layer, uint8_t input);')
        p=source/'src/config.c';s=p.read_text();start=s.index('void configBinding(');end=s.index('// Complemented physical-key masks',start)
        s=s[:start]+'''uint8_t configBindingOffset(uint8_t layer, uint8_t input) {
    return layerOffset(layer) + (uint8_t)(2 * input);
}

'''+s[end:];p.write_text(s)
        p=source/'src/actions.c';s=p.read_text();s=s.replace('  uint8_t first;\n  uint8_t second;','  uint8_t offset;')
        s=s.replace('      first = activeConfig[chordOffset];\n      second = activeConfig[(uint8_t)(chordOffset + 1)];\n','')
        s=s.replace('buttonFirst[other] = first;','buttonFirst[other] = activeConfig[chordOffset];').replace('buttonSecond[other] = second;','buttonSecond[other] = activeConfig[(uint8_t)(chordOffset + 1)];')
        s=s.replace('  configBinding(effectiveLayer, input, &first, &second);\n  buttonFirst[input] = first;\n  buttonSecond[input] = second;',
            '  offset = configBindingOffset(effectiveLayer, input);\n  buttonFirst[input] = activeConfig[offset];\n  buttonSecond[input] = activeConfig[(uint8_t)(offset + 1)];')
        s=s.replace('  configBinding(effectiveLayer, input, &first, &second);\n  runAction(first, second, 1, clockwise ? 7 : 8);',
            '  offset = configBindingOffset(effectiveLayer, input);\n  runAction(activeConfig[offset], activeConfig[(uint8_t)(offset + 1)], 1, clockwise ? 7 : 8);');p.write_text(s)
        replace(source,'tests/config_fixture.h','/* Canonical target-header setters; unrelated fields are retained. */',
            '''#if CONFIG_BINDING_OFFSET
static inline void configBinding(uint8_t layer, uint8_t input, uint8_t *first, uint8_t *second) {
    if (layer >= configLayerCount() || input >= configKeyCount() + 3) { *first = *second = 0; return; }
    uint8_t offset = configBindingOffset(layer, input);
    *first = activeConfig[offset]; *second = activeConfig[(uint8_t)(offset + 1)];
}
#endif

/* Canonical target-header setters; unrelated fields are retained. */''')
    elif name=='load-helper':
        replace(source,'src/actions.c','static FW_BIT tapExpired(uint8_t input) {',
            '''static void loadButton(uint8_t input, uint8_t offset) {
  buttonFirst[input] = activeConfig[offset];
  buttonSecond[input] = activeConfig[(uint8_t)(offset + 1)];
}

static FW_BIT tapExpired(uint8_t input) {''')
        p=source/'src/actions.c';s=p.read_text();needle='  buttonFirst[input] = activeConfig[offset];\n  buttonSecond[input] = activeConfig[(uint8_t)(offset + 1)];'
        start=s.index('static void resolveTap(');s=s[:start]+s[start:].replace(needle,'  loadButton(input, offset);')
        s=s.replace('      buttonFirst[other] = activeConfig[chordOffset];\n      buttonSecond[other] = activeConfig[(uint8_t)(chordOffset + 1)];','      loadButton(other, chordOffset);');p.write_text(s)
    elif name=='stack':
        replace(source,'src/config.c','static __data uint8_t validationMacros;','static __xdata uint8_t validationMacros;')
        replace(source,'src/actions.c','__idata uint16_t tapNow;','__xdata uint16_t tapNow;')
        replace(source,'src/actions.c','resolveTap(uint8_t input, uint8_t branch)','resolveTap(uint8_t input, __xdata uint8_t branch)')
    elif name=='tap-external':
        replace(source,'src/actions.c','__idata uint16_t tapNow;','__xdata uint16_t tapNow;')
    elif name=='binding-params':
        for f in ('src/config.c','src/config.h'):
            replace(source,f,'configBindingOffset(uint8_t layer, uint8_t input)','configBindingOffset(uint8_t layer, __xdata uint8_t input)')
        replace(source,'src/actions.c','loadButton(uint8_t input, uint8_t offset)','loadButton(uint8_t input, __xdata uint8_t offset)')
    elif name=='cold-state':
        for variable in ('lastMouse','macroRepeat'):
            replace(source,'src/actions.c','__idata uint8_t '+variable+';','__xdata uint8_t '+variable+';')
    elif name=='validation-external':
        replace(source,'src/config.c','static __data uint8_t validationMacros;','static __xdata uint8_t validationMacros;')
    elif name=='stable-external':
        replace(source,'CH552_Universal_Macropad.ino','__idata uint8_t stableState[7];','__xdata uint8_t stableState[7];')
    elif name=='wide-optional':
        spec=importlib.util.spec_from_file_location('wide',ROOT/'protocol/wide-arithmetic-audit/measure.py')
        wide=importlib.util.module_from_spec(spec);spec.loader.exec_module(wide)
        for option in wide.OPTIONAL:
            for f,old,new in wide.EDITS[option]:
                p=source/f;s=p.read_text();assert old in s,(f,old);p.write_text(s.replace(old,new))
    elif name=='metadata-subtraction':
        spec=importlib.util.spec_from_file_location('wide',ROOT/'protocol/wide-arithmetic-audit/measure.py')
        wide=importlib.util.module_from_spec(spec);spec.loader.exec_module(wide)
        for f,old,new in wide.EDITS[name]:
            p=source/f;s=p.read_text();assert old in s,(f,old);p.write_text(s.replace(old,new))
    elif name in ('cool-rates','cool-global'):
        for variable in (('USB_globalIdleRate','mouseIdleRate','consumerIdleRate') if name=='cool-rates' else ('USB_globalIdleRate',)):
            replace(source,HID,'__data uint8_t '+variable+';','__xdata uint8_t '+variable+';')
    elif name=='reuse-offset':
        p=source/'src/actions.c';s=p.read_text();s=s.replace('  uint8_t chordOffset;\n','').replace('chordOffset','offset');p.write_text(s)
    elif name=='legacy-order':
        for f in ('src/actions.c','src/actions.h'):
            replace(source,f,'actionsResolveInputs(uint16_t now)','actionsResolveInputs(uint16_t now, uint8_t poll)')
        replace(source,'src/actions.c','  actionsResolveInputs(now);','  actionsResolveInputs(now, 1);')
        replace(source,'CH552_Universal_Macropad.ino','actionsResolveInputs(now);','actionsResolveInputs(now, 0);')
        replace(source,'src/actions.c','if (pendingInput && (uint16_t)(now - pendingSince) >= configChordWindowMs()) {',
            'if (pendingInput && (poll || actionType(buttonFirst[(uint8_t)(pendingInput - 1)]) == CONFIG_ACTION_TAP_HOLD) &&\n'
            '      (uint16_t)(now - pendingSince) >= configChordWindowMs()) {')
    elif name=='tap-comparison':
        replace(source,'src/actions.c','return (elapsed >> 5) > (buttonFirst[input] >> 4);',
            'return elapsed > (((uint16_t)buttonFirst[input] << 1) | 1);')
    elif name=='poll-mask':
        replace(source,'src/actions.c','(poll || actionType(buttonFirst[(uint8_t)(pendingInput - 1)]) == CONFIG_ACTION_TAP_HOLD)',
            '(actionType(buttonFirst[(uint8_t)(pendingInput - 1)] | poll) == CONFIG_ACTION_TAP_HOLD)')
        replace(source,'src/actions.c','actionsResolveInputs(now, 1);','actionsResolveInputs(now, 15);')
    elif name=='tap-index':
        p=source/'src/actions.c';s=p.read_text()
        for index in ('input','other'):
            s=s.replace('tapSince['+index+']','*(__xdata uint16_t *)((__xdata uint8_t *)tapSince + (uint8_t)('+index+' * sizeof(tapSince[0])))')
        p.write_text(s)
    elif name=='poll-external':
        for f in ('src/actions.c','src/actions.h'):
            replace(source,f,'actionsResolveInputs(uint16_t now, uint8_t poll)','actionsResolveInputs(uint16_t now, __xdata uint8_t poll)')
    elif name=='poll-bit':
        for f in ('src/actions.c','src/actions.h'):
            replace(source,f,'actionsResolveInputs(uint16_t now, uint8_t poll)','actionsResolveInputs(uint16_t now)')
        replace(source,'CH552_Universal_Macropad.ino','actionsResolveInputs(now, 0);','actionsResolveInputs(now);')
        replace(source,'src/actions.c','  actionsResolveInputs(now, 1);','  inputPolling = 1;\n  actionsResolveInputs(now);')
        replace(source,'src/actions.c','(poll || actionType(buttonFirst[','(inputPolling || actionType(buttonFirst[')
        replace(source,'src/actions.c','void actionsResolveInputs(uint16_t now) {',
            'static ACTION_BIT inputPolling;\n\nvoid actionsResolveInputs(uint16_t now) {')
        replace(source,'src/actions.c','''      resolveTap(i, 2);
  }
}

void actionsPoll''','''      resolveTap(i, 2);
  }
  inputPolling = 0;
}

void actionsPoll''')
    elif name.startswith('callee-'):
        getters={'layers':'configLayerCount','startup':'configStartupLayer','timed':'configTimedCount','timed-offset':'configTimedOffset',
            'palette':'configLayerPaletteOffset','generation':'USB_reportGeneration','pending':'USB_reportsPending',
            'binding':'configBinding','binding-offset':'configBindingOffset','loader':'loadButton','dispatch':'dispatchButton','expired':'tapExpired',
            'crc':'configCrc','all-getters':'configLayerCount,configStartupLayer,configTimedCount,USB_reportGeneration'}
        replace(source,'platformio.ini','actionsLayer,actionsDropped','actionsLayer,actionsDropped,'+getters[name[7:]])
    elif name in ('allocator','nogcse','noinduction','all-callee'):
        flags={'allocator':'--max-allocs-per-node 100000','nogcse':'--nogcse','noinduction':'--noinduction','all-callee':'--all-callee-saves'}
        with (source/'platformio.ini').open('a') as f:f.write('\n    '+flags[name]+'\n')
    elif name in ('usb-pdata-queue','usb-data-queue','usb-pdata-generation','usb-pdata-idle','usb-data-idle','usb-pdata-clocks','usb-data-clocks','usb-pdata-six'):
        names={'usb-pdata-queue':['reportHead','reportTail','reportCount'],
            'usb-data-queue':['reportHead','reportTail','reportCount'],
            'usb-pdata-generation':['reportGeneration'],
            'usb-pdata-idle':['idleReport','USB_globalIdleRate','mouseIdleRate','consumerIdleRate'],
            'usb-data-idle':['idleReport','USB_globalIdleRate','mouseIdleRate','consumerIdleRate'],
            'usb-pdata-clocks':['keyboardTime','mouseTime','consumerTime'],
            'usb-data-clocks':['keyboardTime','mouseTime','consumerTime'],
            'usb-pdata-six':['reportHead','reportTail','reportCount','reportGeneration','idleReport','USB_globalIdleRate']}[name]
        target='__data' if '-data-' in name else '__pdata'
        for variable in names:
            typename='uint16_t' if variable.endswith('Time') else 'uint8_t'
            replace(source,HID,'__xdata '+typename+' '+variable+';',target+' '+typename+' '+variable+';')
    elif name=='event-parallel':
        replace(source,'src/actions.c','__pdata uint8_t eventData[EVENT_COUNT][2];',
            '__pdata uint8_t eventFirst[EVENT_COUNT];\n__pdata uint8_t eventSecond[EVENT_COUNT];')
        p=source/'src/actions.c';s=p.read_text()
        for index in ('eventHead','eventTail'):
            s=s.replace('eventData['+index+'][0]','eventFirst['+index+']').replace('eventData['+index+'][1]','eventSecond['+index+']')
        p.write_text(s)
    elif name=='dispatch-helper':
        replace(source,'src/actions.c','static FW_BIT tapExpired(uint8_t input) {',
            'static void dispatchButton(uint8_t input) {\n  buttonPressed[input] = 1;\n'
            '  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n  updateLayer();\n}\n\n'
            'static FW_BIT tapExpired(uint8_t input) {')
        p=source/'src/actions.c';s=p.read_text();start=s.index('static void resolveTap(');end=s.index('static void resolvePending(',start)
        body=s[start:end].replace('  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n  updateLayer();','  dispatchButton(input);')
        p.write_text(s[:start]+body+s[end:])
        replace(source,'src/actions.c','''dispatchPress:
  buttonPressed[input] = 1;
  runAction(buttonFirst[input], buttonSecond[input], 0, input);
  updateLayer();''','''dispatchPress:
  dispatchButton(input);''')
    elif name=='raw-pdata':
        replace(source,'CH552_Universal_Macropad.ino','__xdata uint8_t rawState[7];','__pdata uint8_t rawState[7];')
        replace(source,'src/actions.c','__pdata uint8_t lastReportGeneration;','__data uint8_t lastReportGeneration;')


def save(name,source):
    baseline=ART/'baseline/source'
    groups=[('firmware',FILES),('tests',tuple(str(p.relative_to(source)) for p in (source/'tests').glob('*') if p.is_file() and p.suffix in ('.c','.h','.py')))]
    for group,files in groups:
        patch=[]
        for f in sorted(files):
            original=baseline/f
            patch+=difflib.unified_diff(original.read_text().splitlines(True) if original.exists() else [],(source/f).read_text().splitlines(True),fromfile='a/'+f if original.exists() else '/dev/null',tofile='b/'+f)
        (HERE/(name+('' if group=='firmware' else '-tests')+'.patch')).write_text(''.join(patch))
    (HERE/('source-'+name+'-sha256.json')).write_text(json.dumps({f:hashlib.sha256((source/f).read_bytes()).hexdigest() for f in FILES},indent=2)+'\n')


def main():
    names=sys.argv[1:] or ['baseline','combined','stack'];sources={}
    for name in names:
        source=blank(name)
        if name!='baseline':combined(source);optimize(name,source)
        save(name,source);sources[name]=source
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows=list(pool.map(prior.build,[(n,s,v) for n,s in sources.items() for v in (0,1)]))
    dest=HERE/'results.json'
    if dest.exists():rows=[r for r in json.loads(dest.read_text())['rows'] if r['candidate'] not in names]+rows
    dest.write_text(json.dumps(dict(baseline_revision=BASE_REVISION,rows=rows),indent=2)+'\n')


if __name__=='__main__':main()
