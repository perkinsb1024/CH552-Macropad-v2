"""Isolated sparse/wrapper tap-hold alternatives; active inputs are read-only."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ART = Path('/private/tmp/macropad-tap-hold-alternatives')
spec = importlib.util.spec_from_file_location('previous', ROOT / 'protocol/tap-hold-investigation/measure.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.HERE, m.ART = HERE, ART
m.FIRMWARE = (*m.FIRMWARE, 'src/live_state.h')
replace = m.replace


def blank(name):
    source = ART / name / 'source'
    if source.exists(): source.rename(source.with_name('source-before-' + str(time.time_ns())))
    source.mkdir(parents=True, exist_ok=True)
    for directory in ('src', 'tests', 'pio-platform'):
        shutil.copytree(ROOT / directory, source / directory, dirs_exist_ok=True)
    for filename in ('CH552_Universal_Macropad.ino', 'platformio.ini'):
        shutil.copyfile(ROOT / filename, source / filename)
    if not (source / 'webUploader').exists():
        (source / 'webUploader').symlink_to(ROOT / 'webUploader', target_is_directory=True)
    return source


def release_clock(source):
    for filename in ('src/actions.c','src/actions.h'):
        replace(source, filename, 'void actionsRelease(uint8_t input)',
                'void actionsRelease(uint8_t input, __idata uint16_t now)')
    replace(source, 'CH552_Universal_Macropad.ino', 'actionsRelease(input);', 'actionsRelease(input, now);')
    for path in (source / 'tests').glob('*.[ch]'):
        s = path.read_text()
        s = re.sub(r'actionsRelease\(([^();,]+)\)',r'actionsRelease(\1, 0)',s)
        path.write_text(s)


def normalize(source, hold_body):
    path = source / 'src/actions.c'; s=path.read_text()
    a=s.index('  if (pendingInput && (uint16_t)(now - pendingSince) >= configChordWindowMs()) {',s.index('void actionsPoll('))
    b=s.index('  i = USB_reportGeneration();',a)
    old=s[a:b]
    body=old+hold_body
    s=s[:a]+'  actionsResolveInputs(now);\n'+s[b:]
    at=s.index('void actionsPoll(')
    s=s[:at]+'void actionsResolveInputs(uint16_t now) {\n  uint8_t i;\n'+body+'}\n\n'+s[at:]
    path.write_text(s)
    replace(source,'src/actions.h','void actionsPoll(uint16_t now);','void actionsPoll(uint16_t now);\nvoid actionsResolveInputs(uint16_t now);')
    replace(source,'CH552_Universal_Macropad.ino','  for (uint8_t i = 0; i <= NUM_LEDS; i++) {\n    scanButton',
            '  if (activeConfigValid) actionsResolveInputs(now);\n  for (uint8_t i = 0; i <= NUM_LEDS; i++) {\n    scanButton')


def sparse_config(source):
    replace(source,'src/config.h','#define CONFIG_HEADER_SIZE 9',
            '#define CONFIG_HEADER_SIZE 10\n#define CONFIG_HEADER_HOLDS 9\n#define CONFIG_HOLD_COUNT_MASK 31\n#define TAP_SPARSE 1')
    replace(source,'src/config.h','uint8_t configTimedCount(void);',
            'uint8_t configTimedCount(void);\nuint8_t configHold(uint8_t layer, uint8_t input);')
    p=source/'src/config.c';s=p.read_text()
    s=s.replace('offset = 9;', 'offset = CONFIG_HEADER_SIZE;').replace('return 9 + layerSize(', 'return CONFIG_HEADER_SIZE + layerSize(')
    a=s.index('#if CONFIG_TIMED_MAX <= 5\n',s.index('FW_BIT configValid('));b=s.index('    if (end > CONFIG_SIZE)',a)
    s=s[:a]+'''    // Bound products before a wide total: malformed counts must never wrap.
    end = CONFIG_HEADER_SIZE + (uint8_t)(size * validationLayers) +
          (uint8_t)(3 * chords) + (uint8_t)(CONFIG_TIMED_SIZE * timers) +
          (uint16_t)(uint8_t)(3 * (validationImage[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK)) +
          (uint16_t)validationUsed + paletteBytes;
'''+s[b:]
    key='    if (validationUsed && validationImage[(uint8_t)(validationPool + validationUsed - 1)] != 0) {'
    a=s.index(key)
    s=s[:a]+'''    previous = 0;
    for (i = 0; i < (validationImage[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK); i++) {
        id = validationImage[offset];
        // Ascending unique IDs also reject reserved bits through the layer bound.
        if ((id >> 3) >= validationLayers || (id & 7) > keys ||
            (i && id <= previous) || !actionValid(offset + 1, 0)) return 0;
        previous = id;
        offset += 3;
    }
'''+s[a:]
    key='uint8_t configStringChar(uint8_t offset, uint8_t index) {'
    a=s.index(key)
    s=s[:a]+'''uint8_t configHold(uint8_t layer, uint8_t input) {
    uint8_t offset = configTimedOffset() + CONFIG_TIMED_SIZE * configTimedCount();
    uint8_t count = activeConfig[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK;
    uint8_t id = (layer << 3) | input;
    while (count--) {
        if (activeConfig[offset] == id) return offset + 1;
        offset += 3;
    }
    return 0;
}

'''+s[a:]
    s=s.replace('start = configTimedOffset() + CONFIG_TIMED_SIZE * configTimedCount();',
                'start = configTimedOffset() + CONFIG_TIMED_SIZE * configTimedCount() +\n            3 * (activeConfig[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK);')
    p.write_text(s)


def sparse_independent(source):
    release_clock(source)
    replace(source,'src/actions.c','__pdata uint16_t pendingSince;', '''__pdata uint16_t pendingSince;
#define HOLD_INPUTS (PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 4 : 7)
__idata uint16_t tapSince[HOLD_INPUTS];
__idata uint8_t tapHold[HOLD_INPUTS];
__idata uint16_t tapNow;''')
    replace(source,'src/actions.c','static void resolvePending(void) {', '''static FW_BIT tapExpired(uint8_t input) {
  return (uint16_t)(tapNow - tapSince[input]) >=
         ((uint16_t)(activeConfig[CONFIG_HEADER_HOLDS] >> 5) + 2) * 64;
}

static void resolveTap(uint8_t input, uint8_t hold) {
  uint8_t offset = tapHold[input];
  tapHold[input] = 0;
  if (hold) {
    buttonFirst[input] = activeConfig[offset];
    buttonSecond[input] = activeConfig[(uint8_t)(offset + 1)];
  }
  buttonPressed[input] = 1;
  runAction(buttonFirst[input], buttonSecond[input], 0, input);
  updateLayer();
}

static void resolvePending(void) {''')
    replace(source,'src/actions.c','  buttonPressed[input] = 1;\n  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n}\n\nstatic void updateLayer',
            '  if (tapHold[input]) return; // Preserve a captured dual-role assignment across layer changes.\n'
            '  buttonPressed[input] = 1;\n  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n}\n\nstatic void updateLayer')
    replace(source,'src/actions.c','  inputDown |= 1 << input;', '  inputDown |= 1 << input;\n  tapSince[input] = now;')
    replace(source,'src/actions.c','      pendingInput = 0;\n      chordPartner[other]',
            '      pendingInput = 0;\n      tapHold[other] = 0;\n      chordPartner[other]')
    replace(source,'src/actions.c','  buttonSecond[input] = second;\n  orderPress(input);',
            '  buttonSecond[input] = second;\n  tapHold[input] = configHold(effectiveLayer, input);\n  orderPress(input);')
    replace(source,'src/actions.c','  buttonPressed[input] = 1;\n  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n  updateLayer();\n}\n\nstatic void releaseAction',
            '  if (tapHold[input]) return;\n  buttonPressed[input] = 1;\n  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n  updateLayer();\n}\n\nstatic void releaseAction')
    replace(source,'src/actions.c','static void releaseAction(uint8_t input) {',
            'static void releaseAction(uint8_t input) {\n  if (tapHold[input]) resolveTap(input, tapExpired(input));')
    replace(source,'src/actions.c','void actionsRelease(uint8_t input, __idata uint16_t now) {',
            'void actionsRelease(uint8_t input, __idata uint16_t now) {\n  tapNow = now;')
    replace(source,'src/actions.c','  inputDown = 0;',
            '  inputDown = 0;\n  for (i = 0; i < HOLD_INPUTS; i++) tapHold[i] = 0;')
    normalize(source,'''  tapNow = now;
  for (i = 0; i < HOLD_INPUTS; i++) {
    if (tapHold[i] && pendingInput != (uint8_t)(i + 1) && tapExpired(i)) resolveTap(i, 1);
  }
''')


def sparse_single(source):
    release_clock(source)
    replace(source,'src/config.h','#define TAP_SPARSE 1','#define TAP_SPARSE 1\n#define TAP_SINGLE 1')
    replace(source,'src/actions.c','__pdata uint16_t pendingSince;', '''__pdata uint16_t pendingSince;
__idata uint8_t tapPending, tapRef;
__idata uint16_t tapSince, tapNow;''')
    replace(source,'src/actions.c','static void resolvePending(void) {', '''static FW_BIT tapExpired(void) {
  return (uint16_t)(tapNow - tapSince) >=
         ((uint16_t)(activeConfig[CONFIG_HEADER_HOLDS] >> 5) + 2) * 64;
}

static void resolveTap(uint8_t hold) {
  uint8_t input = tapPending - 1;
  uint8_t offset = tapRef;
  tapPending = 0;
  if (hold) {
    buttonFirst[input] = activeConfig[offset];
    buttonSecond[input] = activeConfig[(uint8_t)(offset + 1)];
  }
  buttonPressed[input] = 1;
  runAction(buttonFirst[input], buttonSecond[input], 0, input);
  updateLayer();
}

static void resolvePending(void) {''')
    replace(source,'src/actions.c','  buttonPressed[input] = 1;\n  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n}\n\nstatic void updateLayer',
            '  if (tapPending == (uint8_t)(input + 1)) return;\n'
            '  buttonPressed[input] = 1;\n  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n}\n\nstatic void updateLayer')
    replace(source,'src/actions.c','  inputDown = 0;', '  inputDown = 0;\n  tapPending = 0;')
    replace(source,'src/actions.c','      pendingInput = 0;\n      chordPartner[other]',
            '      pendingInput = 0;\n      if (tapPending == (uint8_t)(other + 1)) tapPending = 0;\n      chordPartner[other]')
    replace(source,'src/actions.c','  configBinding(effectiveLayer, input, &first, &second);\n  buttonFirst[input] = first;',
            '  // Chord matching above always wins over interruption promotion.\n'
            '  if (tapPending) resolveTap(1);\n'
            '  configBinding(effectiveLayer, input, &first, &second);\n  buttonFirst[input] = first;')
    replace(source,'src/actions.c','  buttonSecond[input] = second;\n  orderPress(input);',
            '  buttonSecond[input] = second;\n  tapRef = configHold(effectiveLayer, input);\n'
            '  if (tapRef) { tapPending = input + 1; tapSince = now; }\n  orderPress(input);')
    replace(source,'src/actions.c','  buttonPressed[input] = 1;\n  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n  updateLayer();\n}\n\nstatic void releaseAction',
            '  if (tapPending) return;\n  buttonPressed[input] = 1;\n  runAction(buttonFirst[input], buttonSecond[input], 0, input);\n  updateLayer();\n}\n\nstatic void releaseAction')
    replace(source,'src/actions.c','static void releaseAction(uint8_t input) {',
            'static void releaseAction(uint8_t input) {\n  if (tapPending == (uint8_t)(input + 1)) resolveTap(tapExpired());')
    replace(source,'src/actions.c','void actionsRelease(uint8_t input, __idata uint16_t now) {',
            'void actionsRelease(uint8_t input, __idata uint16_t now) {\n  tapNow = now;')
    replace(source,'src/actions.c','  if (pendingInput && oneShotReturnLayer != 0xFF) {',
            '  if (tapPending && pendingInput != tapPending) resolveTap(1);\n'
            '  if (pendingInput && oneShotReturnLayer != 0xFF) {')
    normalize(source,'''  tapNow = now;
  if (tapPending && pendingInput != tapPending && tapExpired()) resolveTap(1);
''')


def sparse_optimize(name,source):
    if any(x in name for x in ('narrow','fixed','single','opt')):
        replace(source,'src/config.c','''    end = CONFIG_HEADER_SIZE + (uint8_t)(size * validationLayers) +
          (uint8_t)(3 * chords) + (uint8_t)(CONFIG_TIMED_SIZE * timers) +
          (uint16_t)(uint8_t)(3 * (validationImage[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK)) +
          (uint16_t)validationUsed + paletteBytes;''','''    // Each subtotal is byte-bounded independently (<=213 and <=172).
    end = (uint8_t)(CONFIG_HEADER_SIZE + (uint8_t)(size * validationLayers) + (uint8_t)(3 * chords)) +
          (uint16_t)(uint8_t)((uint8_t)(CONFIG_TIMED_SIZE * timers) + validationUsed + paletteBytes) +
          (uint8_t)(3 * (validationImage[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK));''')
        replace(source,'src/config.c','    uint8_t offset;\n    // Keep validator temporaries',
                '    __idata uint8_t offset;\n    // Keep validator temporaries')
        replace(source,'src/config.c','    uint16_t end;','    __idata uint16_t end;')
        for filename in ('src/config.h','src/config.c'):
            replace(source,filename,'configHold(uint8_t layer, uint8_t input)',
                    'configHold(uint8_t layer, __idata uint8_t input)')
    if 'fixed' in name:
        replace(source,'src/config.h','#define TAP_SPARSE 1','#define TAP_SPARSE 1\n#define TAP_FIXED 1')
        old='((uint16_t)(activeConfig[CONFIG_HEADER_HOLDS] >> 5) + 2) * 64'
        replace(source,'src/actions.c',old,'200')


def adapt_header_tests(source):
    # Only profile addresses move. USB report offsets, CRC fields and absolute
    # end-of-image macro boundary tests retain their original byte positions.
    for p in (source/'tests').glob('*.[ch]'):
        s=p.read_text()
        s=re.sub(r'activeConfig\[(\d+)([^\]]*)\]',lambda m:
                 'activeConfig[CONFIG_HEADER_SIZE'+(' + '+str(int(m[1])-9) if int(m[1])!=9 else '')+m[2]+']'
                 if 9<=int(m[1])<=119 else m[0],s)
        s=re.sub(r'activeConfig\s*\+\s*(\d+)',lambda m:
                 'activeConfig + CONFIG_HEADER_SIZE'+(' + '+str(int(m[1])-9) if int(m[1])!=9 else '')
                 if 9<=int(m[1])<=119 else m[0],s)
        # Arithmetic layout bases outside direct array expressions.
        s=re.sub(r'\b(offset|pool|base|chord|rotation|colorOffset|optionsOffset|options|option|encoder|cw|clockwise|end|cursor|first|expected)\s*=\s*9\b',r'\1 = CONFIG_HEADER_SIZE',s)
        s=s.replace('== 9 + size * layers','== CONFIG_HEADER_SIZE + size * layers')
        s=s.replace('CONFIG_SIZE - 9','CONFIG_SIZE - CONFIG_HEADER_SIZE')
        s=s.replace('(9 + (variant', '(CONFIG_HEADER_SIZE + (variant')
        s=s.replace('rotation ? 9 +', 'rotation ? CONFIG_HEADER_SIZE +').replace('+ 1) : 9;', '+ 1) : CONFIG_HEADER_SIZE;')
        s=s.replace('119 - size * layers','CONFIG_SIZE - CONFIG_HEADER_SIZE - size * layers')
        s=s.replace('119 - 15 * layers','CONFIG_SIZE - CONFIG_HEADER_SIZE - 15 * layers')
        s=s.replace('119 - 22 * layers','CONFIG_SIZE - CONFIG_HEADER_SIZE - 22 * layers')
        s=s.replace('0, 119);','0, CONFIG_SIZE - CONFIG_HEADER_SIZE);')
        s=s.replace('variant ? 24 : 31','variant ? CONFIG_HEADER_SIZE + 15 : CONFIG_HEADER_SIZE + 22')
        p.write_text(s)


def wrapper(source, internal=False, fixed=False):
    for suffix in ('.patch','-tests.patch'):
        subprocess.run(['git','apply','--unsafe-paths',str(ROOT/'protocol/tap-hold-investigation'/('complete-small'+suffix))],cwd=source,check=True)
    replace(source,'src/config.c','    if (rotation == 2 && type != CONFIG_ACTION_MACRO) rotation = 1;',
            '    if (rotation == 3) {\n        if (type == CONFIG_ACTION_TAP_HOLD) return 0;\n        rotation = 0;\n    }\n'
            '    if (rotation == 2 && type != CONFIG_ACTION_MACRO) rotation = 1;')
    replace(source,'src/config.c','!actionValid(offset + 1, 0)) {','!actionValid(offset + 1, 3)) {')
    replace(source,'src/actions.c','      tapSince[other] = now; // Chord duration starts at recognition.\n','')
    if internal:
        replace(source,'src/actions.c','__xdata uint16_t tapSince[','__idata uint16_t tapSince[')
        for filename in ('src/actions.c','src/actions.h'):
            replace(source,filename,'actionsRelease(uint8_t input, __xdata uint16_t now)',
                    'actionsRelease(uint8_t input, __idata uint16_t now)')
    if fixed:
        replace(source,'src/actions.c','  return (elapsed >> 5) > (buttonFirst[input] >> 4);','  return elapsed >= 200;')
        replace(source,'src/config.h','#define CONFIG_ACTION_TAP_HOLD         0xF','#define CONFIG_ACTION_TAP_HOLD         0xF\n#define TAP_FIXED 1')


def sparse_tag(source,fixed=False):
    wrapper(source,internal=True,fixed=False)
    for filename in ('src/config.h','src/config.c','src/protocol_firmware.c'):
        shutil.copyfile(ROOT/filename,source/filename)
    sparse_config(source)
    replace(source,'src/config.h','#define TAP_SPARSE 1',
            '#define TAP_SPARSE 1\n#define CONFIG_ACTION_TAP_HOLD 15\nuint8_t configHoldBranch(uint8_t offset, __idata uint8_t hold);')
    replace(source,'tests/protocol_test.c','sent[22] == 0xFF','sent[22] == 0x7F')
    replace(source,'src/actions.c','  return (elapsed >> 5) > (buttonFirst[input] >> 4);',
            '  return elapsed >= ((uint16_t)(activeConfig[CONFIG_HEADER_HOLDS] >> 5) + 2) * 64;')
    replace(source,'src/actions.c','  uint8_t offset = buttonSecond[input] + branch;',
            '  uint8_t offset = configHoldBranch(buttonSecond[input], branch);')
    replace(source,'src/actions.c','  configBinding(effectiveLayer, input, &first, &second);\n  buttonFirst[input] = first;',
            '  configBinding(effectiveLayer, input, &first, &second);\n'
            '  other = configHold(effectiveLayer, input);\n'
            '  if (other) { first = CONFIG_ACTION_TAP_HOLD; second = other; }\n'
            '  buttonFirst[input] = first;')
    replace(source,'src/config.c','uint8_t configHold(uint8_t layer, uint8_t input) {',
            '''uint8_t configHoldBranch(uint8_t offset, __idata uint8_t hold) {
    uint8_t id;
    if (hold) return offset;
    id = activeConfig[(uint8_t)(offset - 1)];
    return layerOffset(id >> 3) + 2 * (id & 7);
}

uint8_t configHold(uint8_t layer, uint8_t input) {''')
    sparse_optimize('sparse-narrow',source)
    if fixed:
        replace(source,'src/config.h','#define TAP_SPARSE 1','#define TAP_SPARSE 1\n#define TAP_FIXED 1')
        replace(source,'src/actions.c','((uint16_t)(activeConfig[CONFIG_HEADER_HOLDS] >> 5) + 2) * 64','200')


def ram_layout(name,source):
    if 'raw' in name:
        replace(source,'CH552_Universal_Macropad.ino','__xdata uint8_t rawState[7];','__idata uint8_t rawState[7];')
    if 'temps' in name:
        replace(source,'src/actions.c','__xdata uint8_t requestedSecond = second;','__idata uint8_t requestedSecond = second;')
        replace(source,'src/actions.c','__xdata uint8_t layer = effectiveLayer;','__idata uint8_t layer = effectiveLayer;')
    if 'maxram' in name:
        ram_layout('raw-temps',source)
        for filename in ('src/actions.c','src/live_state.h'):
            replace(source,filename,'__xdata uint8_t liveBindingLayer','__idata uint8_t liveBindingLayer')
        replace(source,'CH552_Universal_Macropad.ino','__xdata uint16_t errorLedChanged;','__idata uint16_t errorLedChanged;')
    if 'clocks' in name:
        replace(source,'CH552_Universal_Macropad.ino','__xdata uint16_t rawChanged[7];','__idata uint16_t rawChanged[7];')
        for filename in ('src/actions.c','src/actions.h'):
            replace(source,filename,'actionsRelease(uint8_t input, __idata uint16_t now)',
                    'actionsRelease(uint8_t input, __xdata uint16_t now)')
    if 'release' in name:
        for filename in ('src/actions.c','src/actions.h'):
            replace(source,filename,'actionsRelease(uint8_t input, __idata uint16_t now)',
                    'actionsRelease(uint8_t input, __xdata uint16_t now)')
    if 'live' in name:
        for filename in ('src/actions.c','src/live_state.h'):
            replace(source,filename,'__xdata uint8_t liveBindings[13]','__idata uint8_t liveBindings[13]')
        replace(source,'src/actions.c','__idata uint8_t lastMouse;','__xdata uint8_t lastMouse;')


def merge_binding_lookup(source):
    path=source/'src/config.c';s=path.read_text()
    a=s.index('uint8_t configHold(uint8_t layer, __idata uint8_t input) {')
    b=s.index('uint8_t configStringChar(',a)
    body=s[a:b]
    body=body[body.index('{')+1:body.rindex('}')]
    s=s[:a]+s[b:]
    start=s.index('void configBinding(');end=s.index('FW_BIT configChord(',start)
    binding=s[start:end].replace('void configBinding(', 'uint8_t configBinding(').replace('        return;', '        return 0;')
    body=body.replace('    uint8_t offset =', '    offset =')
    at=binding.rindex('}')
    binding=binding[:at]+body+binding[at:]
    s=s[:start]+binding+s[end:];path.write_text(s)
    replace(source,'src/config.h','void configBinding(', 'uint8_t configBinding(')
    replace(source,'src/config.h','uint8_t configHold(uint8_t layer, __idata uint8_t input);\n','')
    p=source/'src/actions.c';s=p.read_text()
    if 'tapHold[HOLD_INPUTS]' in s:
        old='  configBinding(effectiveLayer, input, &first, &second);\n  buttonFirst[input] = first;'
        assert s.count(old)==1
        s=s.replace(old,'  other = configBinding(effectiveLayer, input, &first, &second);\n  buttonFirst[input] = first;')
        s=s.replace('  tapHold[input] = configHold(effectiveLayer, input);','  tapHold[input] = other;')
    elif 'tapPending, tapRef' in s:
        old='  configBinding(effectiveLayer, input, &first, &second);\n  buttonFirst[input] = first;'
        assert s.count(old)==1
        s=s.replace(old,'  tapRef = configBinding(effectiveLayer, input, &first, &second);\n  buttonFirst[input] = first;')
        s=s.replace('  tapRef = configHold(effectiveLayer, input);\n','')
    else:
        old='  configBinding(effectiveLayer, input, &first, &second);\n  other = configHold(effectiveLayer, input);'
        assert s.count(old)==1
        s=s.replace(old,'  other = configBinding(effectiveLayer, input, &first, &second);')
    p.write_text(s)


def central_wrapper_validation(source):
    replace(source,'src/config.c','''    if (rotation == 3) {
        if (type == CONFIG_ACTION_TAP_HOLD) return 0;
        rotation = 0;
    }
''','')
    replace(source,'src/config.c','!actionValid(offset + 1, 3)) {','!actionValid(offset + 1, 0)) {')
    replace(source,'src/config.c','            return !rotation && param > (uint8_t)(validationPool + validationUsed) && param < macros &&',
            '            return !rotation && offset < (uint8_t)(CONFIG_HEADER_SIZE + (uint8_t)(layerSize(validationImage[CONFIG_HEADER_LAYERS] & 1) * validationLayers)) &&\n'
            '                   param > (uint8_t)(validationPool + validationUsed) && param < macros &&')
    replace(source,'src/config.c','''            if ((validationImage[offset] & 15) == CONFIG_ACTION_TAP_HOLD ||
                !actionValid(offset, !((offset ^ validationMacros) & 2))) return 0;''',
            '            if (!actionValid(offset, !((offset ^ validationMacros) & 2))) return 0;')


def wrapper_single(source):
    replace(source,'src/config.h','#define TAP_FIXED 1','#define TAP_FIXED 1\n#define TAP_SINGLE 1')
    replace(source,'src/actions.c','__idata uint16_t tapSince[PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 4 : 7];\n','')
    replace(source,'src/actions.c','  tapSince[input] = now;\n','')
    replace(source,'src/actions.c','tapExpired(uint8_t input)','tapExpired(void)')
    replace(source,'src/actions.c','tapNow - tapSince[input]','tapNow - pendingSince')
    replace(source,'src/actions.c','tapExpired(input)','tapExpired()')
    replace(source,'src/actions.c','  uint8_t offset = buttonSecond[input] + branch;',
            '  uint8_t offset = buttonSecond[input] + branch;\n  pendingInput = 0;\n  buttonPressed[input] = 1;')
    replace(source,'src/actions.c','  input = pendingInput - 1;\n  pendingInput = 0;',
            '  input = pendingInput - 1;\n  if (actionType(buttonFirst[input]) == CONFIG_ACTION_TAP_HOLD) return;\n  pendingInput = 0;')
    replace(source,'src/actions.c','  if (pendingInput && (input < keys || oneShotReturnLayer != 0xFF)) {',
            '  if (pendingInput && (input < keys || oneShotReturnLayer != 0xFF ||\n      actionType(buttonFirst[(uint8_t)(pendingInput - 1)]) == CONFIG_ACTION_TAP_HOLD)) {')
    replace(source,'src/actions.c','    resolvePending();\n    updateLayer();\n  }\n  configBinding(effectiveLayer, input, &first, &second);\n  buttonFirst[input] = first;',
            '    if (actionType(buttonFirst[other]) == CONFIG_ACTION_TAP_HOLD) resolveTap(other, 2);\n'
            '    else { resolvePending(); updateLayer(); }\n  }\n'
            '  configBinding(effectiveLayer, input, &first, &second);\n'
            '  if (pendingInput && actionType(first) == CONFIG_ACTION_TAP_HOLD) {\n'
            '    resolvePending(); updateLayer();\n'
            '    configBinding(effectiveLayer, input, &first, &second);\n  }\n  buttonFirst[input] = first;')
    replace(source,'src/actions.c','  orderPress(input);\n  if (input < keys && chordWindow)',
            '  orderPress(input);\n  if (actionType(first) == CONFIG_ACTION_TAP_HOLD) goto waitInput;\n'
            '  if (input < keys && chordWindow)')
    replace(source,'src/actions.c','        pendingInput = input + 1;',
            'waitInput:\n        pendingInput = input + 1;')
    replace(source,'src/actions.c','  if (buttonPressed[input] && actionType(buttonFirst[input]) == CONFIG_ACTION_TAP_HOLD)',
            '  if (pendingInput == (uint8_t)(input + 1) && actionType(buttonFirst[input]) == CONFIG_ACTION_TAP_HOLD)')
    replace(source,'src/actions.c','  if (pendingInput && oneShotReturnLayer != 0xFF) {',
            '  if (pendingInput && actionType(buttonFirst[(uint8_t)(pendingInput - 1)]) == CONFIG_ACTION_TAP_HOLD &&\n'
            '      (uint16_t)(tapNow - pendingSince) >= configChordWindowMs()) resolveTap(pendingInput - 1, 2);\n'
            '  if (pendingInput && oneShotReturnLayer != 0xFF) {')
    p=source/'src/actions.c';s=p.read_text();a=s.index('void actionsResolveInputs(');b=s.index('void actionsPoll(',a)
    s=s[:a]+'''void actionsResolveInputs(uint16_t now) {
  uint8_t input;
  tapNow = now;
  if (!pendingInput) return;
  input = pendingInput - 1;
  if (actionType(buttonFirst[input]) == CONFIG_ACTION_TAP_HOLD) {
    if (tapExpired()) resolveTap(input, 2);
  } else if ((uint16_t)(now - pendingSince) >= configChordWindowMs()) {
    resolvePending(); updateLayer();
  }
}

'''+s[b:];p.write_text(s)


def linear_ids(source):
    replace(source,'src/config.h','#define TAP_SPARSE 1','#define TAP_SPARSE 1\n#define TAP_LINEAR 1')
    replace(source,'src/config.c','(id >> 3) >= validationLayers || (id & 7) > keys',
            'id >= (uint8_t)(validationLayers * (uint8_t)(keys + 1))')
    replace(source,'src/config.c','uint8_t id = (layer << 3) | input;',
            'uint8_t id = layer * (uint8_t)(configKeyCount() + 1) + input;')


def tail_records(source):
    replace(source,'src/config.h','#define TAP_SPARSE 1','#define TAP_SPARSE 1\n#define TAP_TAIL 1')
    replace(source,'src/config.c','static const __xdata uint8_t *__data validationImage;',
            'static __idata uint8_t validationEnd;\nstatic const __xdata uint8_t *__data validationImage;')
    replace(source,'src/config.c','param >= CONFIG_SIZE) return 0;', 'param >= validationEnd) return 0;')
    replace(source,'src/config.c','''    end = (uint8_t)(CONFIG_HEADER_SIZE + (uint8_t)(size * validationLayers) + (uint8_t)(3 * chords)) +
          (uint16_t)(uint8_t)((uint8_t)(CONFIG_TIMED_SIZE * timers) + validationUsed + paletteBytes) +
          (uint8_t)(3 * (validationImage[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK));
    if (end > CONFIG_SIZE) {''','''    end = (uint8_t)(CONFIG_HEADER_SIZE + (uint8_t)(size * validationLayers) + (uint8_t)(3 * chords)) +
          (uint16_t)(uint8_t)((uint8_t)(CONFIG_TIMED_SIZE * timers) + validationUsed + paletteBytes);
    validationEnd = CONFIG_SIZE - (uint8_t)(3 * (validationImage[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK));
    if (end > validationEnd) {''')
    replace(source,'src/config.c','    previous = 0;\n    for (i = 0; i < (validationImage[CONFIG_HEADER_HOLDS]',
            '    previous = 0;\n    offset = validationEnd;\n    for (i = 0; i < (validationImage[CONFIG_HEADER_HOLDS]')
    replace(source,'src/config.c','for (offset = validationPool + validationUsed; offset < CONFIG_SIZE; offset++)',
            'for (offset = validationPool + validationUsed; offset < validationEnd; offset++)')
    replace(source,'src/config.c','if (offset == CONFIG_SIZE - 1 || !actionValid(offset, 2)) return 0;',
            'if (offset == (uint8_t)(validationEnd - 1) ||\n'
            '            (validationEnd != CONFIG_SIZE && offset == (uint8_t)(validationEnd - 2)) ||\n'
            '            !actionValid(offset, 2)) return 0;')
    replace(source,'src/config.c','''    offset = configTimedOffset() + CONFIG_TIMED_SIZE * configTimedCount();
    uint8_t count = activeConfig[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK;''','''    uint8_t count = activeConfig[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK;
    offset = CONFIG_SIZE - (uint8_t)(3 * count);''')
    replace(source,'src/config.c','''start = configTimedOffset() + CONFIG_TIMED_SIZE * configTimedCount() +
            3 * (activeConfig[CONFIG_HEADER_HOLDS] & CONFIG_HOLD_COUNT_MASK);''',
            'start = configTimedOffset() + CONFIG_TIMED_SIZE * configTimedCount();')


def add_hid(source):
    result=subprocess.run(['git','apply','--unsafe-paths','--exclude=src/actions.h','--exclude=tests/run_host_tests.py',
                           str(ROOT/'protocol/hid-layer-investigation/recommended.patch')],cwd=source,capture_output=True,text=True)
    if result.returncode:raise RuntimeError(result.stderr)
    replace(source,'src/actions.h','uint8_t actionsLayer(void);','uint8_t actionsLayer(void);\nvoid actionsSetLayer(uint8_t options);')
    for p in (source/'tests').glob('*.[ch]'):
        text=p.read_text();text=re.sub(r'actionsRelease\(([^();,]+)\)',r'actionsRelease(\1, 0)',text);p.write_text(text)
    p=source/'tests/run_host_tests.py';text=p.read_text();text=text.replace('    for suite in suites:',
        '    suites += [("input_layer", ["src/config.c", "src/actions.c", "src/storage.c", "src/protocol_firmware.c"], variant) for variant in (0, 1)]\n    for suite in suites:');p.write_text(text)
    if 'TAP_SPARSE' in (source/'src/config.h').read_text():adapt_header_tests(source)


def prepare(name):
    source=blank(name)
    if name.startswith('wrapper'):
        wrapper(source,internal='internal' in name or 'single' in name,fixed='fixed' in name or 'single' in name)
        if 'bound' in name or 'single' in name: central_wrapper_validation(source)
        if 'single' in name: wrapper_single(source)
    elif name.startswith('sparse-tag'):
        sparse_tag(source,fixed='fixed' in name)
        adapt_header_tests(source)
    elif name.startswith('sparse'):
        sparse_config(source)
        if 'single' in name: sparse_single(source)
        else: sparse_independent(source)
        sparse_optimize(name,source)
        adapt_header_tests(source)
    elif name!='baseline': raise ValueError(name)
    if 'merged' in name: merge_binding_lookup(source)
    if 'linear' in name: linear_ids(source)
    if 'tail' in name: tail_records(source)
    if any(x in name for x in ('raw','temps','maxram','clocks','live','release')): ram_layout(name,source)
    if name.endswith('-combined'):add_hid(source)
    # Include storage annotations in the saved firmware patch.
    m.save(name,source)
    return source


def main():
    names=[x for x in sys.argv[1:] if not x.startswith('--')] or ['baseline','wrapper-internal','sparse-internal']
    sources={name:prepare(name) for name in names}
    if '--prepare-only' in sys.argv: return
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows=list(pool.map(m.build,[(n,s,v) for n,s in sources.items() for v in (0,1)]))
    dest=HERE/'results.json'
    if dest.exists(): rows=[r for r in json.loads(dest.read_text())['rows'] if r['candidate'] not in names]+rows
    dest.write_text(json.dumps(dict(baseline_revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),rows=rows),indent=2)+'\n')

if __name__=='__main__': main()
