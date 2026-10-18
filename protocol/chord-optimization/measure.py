"""Behavior-preserving chord candidates, measured in isolated source trees."""
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

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ART = Path('/private/tmp/macropad-chord-optimization')
spec = importlib.util.spec_from_file_location('prior', ROOT / 'protocol/tap-hold-investigation/measure.py')
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
prior.HERE, prior.ART = HERE, ART
replace = prior.replace
FILES = (*prior.FIRMWARE, 'platformio.ini')


def rewrite(source, filename, function):
    p = source / filename
    p.write_text(function(p.read_text()))


def mask_lookup(source, direct=False):
    # A singleton mask asks whether an input participates in any applicable chord;
    # a two-bit mask asks for that exact pair. The caller bounds input and layer.
    replace(source, 'src/config.h', 'FW_BIT configChord(uint8_t layer, uint8_t firstKey, uint8_t secondKey, __data uint8_t *first, __data uint8_t *second);',
        '#define CONFIG_CHORD_MASK_LOOKUP 1\n'
        '// Validated active image, valid layer and one/two physical input bits.\n'
        '// Return the first matching action offset, or zero. Locals precede globals.\n'
        'uint8_t configChordOffset(uint8_t layer, uint8_t inputs);')
    p = source / 'src/config.c'
    s = p.read_text()
    a = s.index('static uint8_t pairIndex(')
    b = s.index('uint16_t configCrc(', a)
    s = s[:a] + s[b:]
    a = s.index('FW_BIT configChord(')
    b = s.index('uint8_t configTimedCount(', a)
    table = '''#if !defined(__SDCC) || PHYSICAL_VARIANT == CONFIG_THREE_KEYS
static const __code uint8_t chordPairsThree[] = {3, 5, 6};
#endif
#if !defined(__SDCC) || PHYSICAL_VARIANT == CONFIG_SIX_KEYS
static const __code uint8_t chordPairsSix[] = {3, 5, 9, 17, 33, 6, 10, 18, 34, 12, 20, 36, 24, 40, 48};
#endif

uint8_t configChordOffset(uint8_t layer, uint8_t inputs) {
    uint8_t count = activeConfig[CONFIG_HEADER_COUNTS] >> CONFIG_HEADER_CHORD_SHIFT;
    uint8_t offset = configLayerPaletteOffset(configLayerCount());
    uint8_t id;
    uint8_t pair;
    layer <<= 4;
    while (count--) {
        id = activeConfig[offset];
        if ((id & 0xF0) == layer || (id & 0xF0) == 0x70) {
#ifdef __SDCC
#if PHYSICAL_VARIANT == CONFIG_THREE_KEYS
            pair = chordPairsThree[id & 15];
#else
            pair = chordPairsSix[id & 15];
#endif
#else
            pair = configKeyCount() == 3 ? chordPairsThree[id & 15] : chordPairsSix[id & 15];
#endif
            if ((pair & inputs) == inputs) return offset + 1;
        }
        offset += 3;
    }
    return 0;
}

'''
    s = s[:a] + table + s[b:]
    p.write_text(s)
    p = source / 'src/actions.c'
    s = p.read_text()
    s = s.replace('  uint8_t other;\n  uint8_t keys', '  uint8_t other;\n  uint8_t chordOffset;\n  uint8_t keys')
    s = s.replace('        configChord(pendingLayer, other, input, &first, &second)) {',
        '        (chordOffset = configChordOffset(pendingLayer,\n'
        '            (uint8_t)((1u << other) | (1u << input))))) {\n'
        '      first = activeConfig[chordOffset];\n'
        '      second = activeConfig[(uint8_t)(chordOffset + 1)];')
    a = s.index('    for (other = 0; other < keys; other++) {', s.index('void actionsPress('))
    b = s.index('  buttonPressed[input] = 1;\n  runAction', a)
    s = s[:a] + '''    if (configChordOffset(effectiveLayer, (uint8_t)(1u << input))) {
      pendingInput = input + 1;
#if CONFIG_SCROLL_ACCELERATION
      scrollFirst = 0; // A pending chord is a distinct physical trigger.
#endif
      pendingLayer = effectiveLayer;
      pendingSince = now;
      return;
    }
  }
''' + s[b:]
    if direct:
        s = s.replace('      first = activeConfig[chordOffset];\n      second = activeConfig[(uint8_t)(chordOffset + 1)];\n', '')
        s = s.replace('      buttonFirst[other] = first;\n      buttonSecond[other] = second;',
            '      buttonFirst[other] = activeConfig[chordOffset];\n'
            '      buttonSecond[other] = activeConfig[(uint8_t)(chordOffset + 1)];')
        s = s.replace('      runAction(first, second, 0, other);',
            '      runAction(buttonFirst[other], buttonSecond[other], 0, other);')
    p.write_text(s)
    # Retain the old defensive API in the test fixture only. Production tests of
    # the new API below also cover singleton/exact queries independently.
    replace(source, 'tests/config_fixture.h', '/* Canonical target-header setters;',
        '''#if CONFIG_CHORD_MASK_LOOKUP
static inline FW_BIT configChord(uint8_t layer, uint8_t firstKey, uint8_t secondKey,
        uint8_t *first, uint8_t *second) {
    uint8_t keys = configKeyCount();
    if (layer >= configLayerCount() || firstKey >= keys || secondKey >= keys || firstKey == secondKey) return 0;
    uint8_t offset = configChordOffset(layer, (uint8_t)((1u << firstKey) | (1u << secondKey)));
    if (!offset) return 0;
    *first = activeConfig[offset]; *second = activeConfig[(uint8_t)(offset + 1)];
    return 1;
}
#endif

/* Canonical target-header setters;''')


def pair_offset(source):
    replace(source, 'src/config.h', 'FW_BIT configChord(uint8_t layer, uint8_t firstKey, uint8_t secondKey, __data uint8_t *first, __data uint8_t *second);',
        '#define CONFIG_CHORD_PAIR_OFFSET 1\nuint8_t configChordOffset(uint8_t layer, uint8_t firstKey, uint8_t secondKey);')
    p = source / 'src/config.c'
    s = p.read_text().replace('FW_BIT configChord(uint8_t layer, uint8_t firstKey, uint8_t secondKey,\n                    __data uint8_t *first, __data uint8_t *second)',
                             'uint8_t configChordOffset(uint8_t layer, uint8_t firstKey, uint8_t secondKey)')
    s = s.replace('            *first = activeConfig[(uint8_t)(offset + 1)];\n            *second = activeConfig[(uint8_t)(offset + 2)];\n            return 1;',
                  '            return offset + 1;')
    p.write_text(s)
    p = source / 'src/actions.c'
    s = p.read_text().replace('  uint8_t other;\n  uint8_t keys', '  uint8_t other;\n  uint8_t chordOffset;\n  uint8_t keys')
    s = s.replace('        configChord(pendingLayer, other, input, &first, &second)) {',
        '        (chordOffset = configChordOffset(pendingLayer, other, input))) {\n'
        '      first = activeConfig[chordOffset];\n      second = activeConfig[(uint8_t)(chordOffset + 1)];')
    s = s.replace('configChord(effectiveLayer, input, other, &first, &second)', 'configChordOffset(effectiveLayer, input, other)')
    p.write_text(s)
    replace(source, 'tests/config_fixture.h', '/* Canonical target-header setters;',
        '''#if CONFIG_CHORD_PAIR_OFFSET
static inline FW_BIT configChord(uint8_t layer, uint8_t firstKey, uint8_t secondKey,
        uint8_t *first, uint8_t *second) {
    uint8_t offset = configChordOffset(layer, firstKey, secondKey);
    if (!offset) return 0;
    *first = activeConfig[offset]; *second = activeConfig[(uint8_t)(offset + 1)];
    return 1;
}
#endif

/* Canonical target-header setters;''')


def shared_dispatch(source):
    replace(source, 'src/actions.c', '''      buttonPressed[other] = 1;
      orderPress(other);
      runAction(first, second, 0, other);
      updateLayer();
      return;''', '''      input = other;
      orderPress(input);
      goto dispatchPress;''')
    replace(source, 'src/actions.c', '''  buttonPressed[input] = 1;
  runAction(buttonFirst[input], buttonSecond[input], 0, input);
  updateLayer();
}

static void releaseAction''', '''dispatchPress:
  buttonPressed[input] = 1;
  runAction(buttonFirst[input], buttonSecond[input], 0, input);
  updateLayer();
}

static void releaseAction''')


def cached_mask(source):
    replace(source, 'src/actions.c', '''  // The range guard bounds the shift to 0..6; test only the byte-sized mask.
  if (input > keys || (inputDown & (uint8_t)(1u << input))) {
    return;
  }
  inputDown |= 1 << input;''', '''  uint8_t inputMask;
  if (input > keys) return;
  inputMask = (uint8_t)(1u << input);
  if (inputDown & inputMask) return;
  inputDown |= inputMask;''')
    p = source / 'src/actions.c'
    s = p.read_text().replace('(uint8_t)((1u << other) | (1u << input))', '(uint8_t)((1u << other) | inputMask)')
    s = s.replace('configChordOffset(effectiveLayer, (uint8_t)(1u << input))', 'configChordOffset(effectiveLayer, inputMask)')
    p.write_text(s)


def edits(name, source):
    if name == 'optimized-no-chords':
        original=ART/'baseline/source'
        for filename in FILES:shutil.copyfile(original/filename,source/filename)
        for filename in ('tests/config_fixture.h','tests/run_host_tests.py'):shutil.copyfile(original/filename,source/filename)
        subprocess.run(['git','apply','--unsafe-paths',str(ROOT/'protocol/tap-hold-no-chords/no-chords.patch')],cwd=source,check=True)
        cached_mask(source)
        replace(source,'src/actions.c','__pdata uint8_t inputDown;','__data uint8_t inputDown;')
        replace(source,'src/actions.c','__pdata uint8_t timedWork; // Shared interval/release-mask scratch.\n','')
        replace(source,'src/actions.c','  timedWork = 1 << input;\n  if (!(inputDown & timedWork)) return;\n  inputDown &= ~timedWork;',
            '  uint8_t released = (uint8_t)(1u << input);\n  if (!(inputDown & released)) return;\n  inputDown &= ~released;')
        p=source/'src/actions.c';s=p.read_text().replace('void actionsPress(uint8_t input, uint16_t now) {',
            'static const __code uint8_t inputBits[] = {1, 2, 4, 8,\n#if !defined(__SDCC) || PHYSICAL_VARIANT == CONFIG_SIX_KEYS\n16, 32, 64\n#endif\n};\n\nvoid actionsPress(uint8_t input, uint16_t now) {')
        s=s.replace('(uint8_t)(1u << input)','inputBits[input]');p.write_text(s)
    elif name == 'final':
        for filename in FILES:
            shutil.copyfile(ART/'data-all-init/source'/filename,source/filename)
        shutil.copyfile(ART/'data-all-init/source/tests/config_fixture.h',source/'tests/config_fixture.h')
        p=source/'src/config.c';s=p.read_text()
        s=s.replace('chordPairsThree','chordExcludedThree').replace('chordPairsSix','chordExcludedSix')
        s=s.replace('uint8_t pair;','uint8_t excluded;').replace('pair = chordExcluded','excluded = chordExcluded').replace('pair = configKeyCount()', 'excluded = configKeyCount()').replace('!(pair & inputs)','!(excluded & inputs)')
        s=s.replace('#if !defined(__SDCC) || PHYSICAL_VARIANT == CONFIG_THREE_KEYS\nstatic const',
            '// Complemented physical-key masks, in the saved lexicographic pair order.\n'
            '// An input mask is contained in a chord when none of its bits is excluded.\n'
            '#if !defined(__SDCC) || PHYSICAL_VARIANT == CONFIG_THREE_KEYS\nstatic const')
        s=s.replace('{252, 250, 249}','{0xFC, 0xFA, 0xF9}')
        s=s.replace('{252, 250, 246, 238, 222, 249, 245, 237, 221, 243, 235, 219, 231, 215, 207}',
            '{\n    0xFC, 0xFA, 0xF6, 0xEE, 0xDE, 0xF9, 0xF5, 0xED, 0xDD, 0xF3, 0xEB, 0xDB, 0xE7, 0xD7, 0xCF\n}')
        p.write_text(s)
        p=source/'src/actions.c';s=p.read_text().replace('static const __code uint8_t inputBits[] = {1, 2, 4, 8, 16, 32, 64};',
            '// Input range guards bound these indexes before use.\n'
            'static const __code uint8_t inputBits[] = {\n'
            '  1, 2, 4, 8,\n#if !defined(__SDCC) || PHYSICAL_VARIANT == CONFIG_SIX_KEYS\n  16, 32, 64\n#endif\n};')
        s=s.replace('__data uint8_t inputDown;', '// Direct state avoids repeated paged loads; native stack reserve stays above baseline.\n__data uint8_t inputDown;')
        s=s.replace('  if (pendingInput == (uint8_t)(input + 1)) {',
            '  // The range guard bounds input + 1 to 1..7; compare only that byte.\n  if (pendingInput == (uint8_t)(input + 1)) {')
        p.write_text(s)
        replace(source,'src/config.h','// Validated active image, valid layer and one/two physical input bits.',
            '// Requires a validated active image, valid layer and physical input bits.\n'
            '// One bit queries chord eligibility; two bits query that exact pair.')
        shutil.copyfile(HERE/'chord_lookup_test.c',source/'tests/chord_lookup_test.c')
        replace(source,'tests/run_host_tests.py','    for suite in suites:',
            '    suites += [("chord_lookup", ["src/config.c"], variant) for variant in (0, 1)]\n    for suite in suites:')
    elif name == 'global-byte':
        replace(source, 'src/config.c', 'activeConfig[offset] == (0x70 | (id & 15))', 'activeConfig[offset] == (uint8_t)(0x70 | (id & 15))')
    elif name == 'lookup-countdown':
        replace(source, 'src/config.c', '    for (i = 0; i < count; i++, offset += 3) {', '    for (; count--; offset += 3) {')
    elif name == 'lookup-single-read':
        replace(source, 'src/config.c', '    uint8_t swap;', '    uint8_t swap;\n    uint8_t candidate;')
        replace(source, 'src/config.c', '        if (activeConfig[offset] == id ||\n            activeConfig[offset] == (0x70 | (id & 15))) {',
            '        candidate = activeConfig[offset];\n        if (candidate == id || candidate == (uint8_t)(0x70 | (id & 15))) {')
    elif name == 'lookup-nibble':
        replace(source, 'src/config.c', '        if (activeConfig[offset] == id ||\n            activeConfig[offset] == (0x70 | (id & 15))) {',
            '        uint8_t candidate = activeConfig[offset];\n'
            '        if ((candidate & 15) == (id & 15) &&\n'
            '            ((candidate >> 4) == layer || (candidate >> 4) == 7)) {')
    elif name == 'pair-inline':
        p = source / 'src/config.c'; s = p.read_text()
        a=s.index('static uint8_t pairIndex(');b=s.index('uint16_t configCrc(',a)
        s=s[:a]+'#define pairIndex(a, b, keys) (((uint8_t)((a) * (2 * (keys) - (a) - 3)) >> 1) + (b) - 1)\n\n'+s[b:]
        p.write_text(s)
    elif name == 'pair-table':
        replace(source, 'src/config.c', '    return ((uint8_t)(a * (2 * keys - a - 3)) >> 1) + b - 1;',
            '    static const __code uint8_t bases[] = {0, 4, 7, 9, 10};\n'
            '    return (keys == 3 ? a : bases[a]) + b - 1;')
    elif name == 'validator-scope':
        replace(source, 'src/config.c', '((id >> 4) != 7 && (id >> 4) >= validationLayers)',
            '(id >= (uint8_t)(validationLayers << 4) && (id & 0xF0) != 0x70)')
    elif name == 'validator-order':
        replace(source, 'src/config.c', '(i && id <= previous)', '((uint8_t)(id + 1) <= previous)')
        replace(source, 'src/config.c', '        previous = id;', '        previous = id + 1;')
    elif name == 'shared-dispatch': shared_dispatch(source)
    elif name == 'cached-mask': cached_mask(source)
    elif name == 'offset-pair': pair_offset(source)
    elif name in ('mask-lookup', 'mask-direct'): mask_lookup(source, direct=name == 'mask-direct')
    elif name == 'resolve-unguarded':
        replace(source, 'src/actions.c', '  if (!pendingInput) {\n    return;\n  }\n', '')
        replace(source, 'src/actions.c', '    // Pending singles belong to the layer on which they were pressed.\n    resolvePending();',
            '    // Pending singles belong to the layer on which they were pressed.\n    if (pendingInput) resolvePending();')
    elif name == 'partner-internal':
        replace(source, 'src/actions.c', '__pdata uint8_t chordPartner[6];', '__idata uint8_t chordPartner[6];')
    elif name == 'pending-internal':
        for item in ('uint8_t pendingInput;', 'uint8_t pendingLayer;', 'uint16_t pendingSince;'):
            replace(source, 'src/actions.c', '__pdata ' + item, '__idata ' + item)
    elif name == 'mask-combined':
        for part in ('mask-lookup', 'shared-dispatch', 'cached-mask', 'validator-scope', 'validator-order'):
            edits(part, source)
    elif name == 'local-combined':
        for part in ('global-byte', 'lookup-countdown', 'pair-inline', 'shared-dispatch', 'cached-mask', 'validator-scope', 'validator-order'):
            edits(part, source)
    elif name == 'mask-callee':
        edits('mask-combined', source)
        replace(source, 'platformio.ini', 'actionsLayer,actionsDropped', 'actionsLayer,actionsDropped,configChordOffset')
    elif name in ('local-selected', 'mask-selected'):
        for part in (('lookup-single-read','pair-inline') if name=='local-selected' else ('mask-lookup',)):
            edits(part,source)
        for part in ('shared-dispatch','cached-mask'):
            edits(part,source)
    elif name.startswith('mask-') and name in ('mask-narrow','mask-scope','mask-xor','mask-do','mask-physical','mask-time','mask-time-bytes','mask-release','mask-links','mask-narrow-time','mask-narrow-physical','mask-final-probe'):
        edits('mask-selected',source)
        parts={
            'mask-narrow':['narrow'], 'mask-scope':['scope'], 'mask-xor':['xor'], 'mask-do':['do'],
            'mask-physical':['physical'], 'mask-time':['time'], 'mask-time-bytes':['time-bytes'],
            'mask-release':['release'], 'mask-links':['links'], 'mask-narrow-time':['narrow','time'],
            'mask-narrow-physical':['narrow','physical'],
            'mask-final-probe':['narrow','physical','time','release','links','do'],
        }[name]
        for part in parts:
            if part in ('narrow','scope'):
                replace(source,'src/config.c','    uint8_t pair;','    uint8_t pair;\n    uint8_t scope;')
                replace(source,'src/config.c','    layer <<= 4;','')
                replace(source,'src/config.c','        if ((id & 0xF0) == layer || (id & 0xF0) == 0x70) {',
                    '        scope = id >> 4;\n        if (scope == layer || scope == 7) {')
                if part=='narrow':
                    p=source/'src/config.c';s=p.read_text().replace('chordPairsThree[id & 15]','chordPairsThree[(uint8_t)(id & 15)]').replace('chordPairsSix[id & 15]','chordPairsSix[(uint8_t)(id & 15)]');p.write_text(s)
            elif part=='xor':
                replace(source,'src/config.c','            if ((pair & inputs) == inputs) return offset + 1;',
                    '            if (!(inputs & (uint8_t)~pair)) return offset + 1;')
            elif part=='do':
                replace(source,'src/config.c','    uint8_t offset = configLayerPaletteOffset(configLayerCount());',
                    '    uint8_t offset;\n    if (!count) return 0;\n    offset = configLayerPaletteOffset(configLayerCount());')
                replace(source,'src/config.c','    while (count--) {','    do {')
                replace(source,'src/config.c','        offset += 3;\n    }\n    return 0;','        offset += 3;\n    } while (--count);\n    return 0;')
            elif part=='physical':
                p=source/'src/actions.c';s=p.read_text();a=s.index('void actionsPress(');b=s.index('static void releaseAction',a)
                body=s[a:b].replace('  uint8_t inputMask;','  FW_BIT physical;\n  uint8_t inputMask;').replace('  if (input > keys) return;',
                    '  if (input > keys) return;\n  physical = input != keys;').replace('input < keys','physical')
                p.write_text(s[:a]+body+s[b:])
            elif part in ('time','time-bytes'):
                replace(source,'src/actions.c','void actionsPress(uint8_t input, uint16_t now) {',
                    'static FW_BIT chordWithinWindow(uint16_t now, uint8_t window) {\n'
                    '  uint16_t elapsed = now - pendingSince;\n'
                    + ('  return !(elapsed >> 8) && (uint8_t)elapsed < window;\n' if part=='time-bytes' else '  return elapsed < window;\n')
                    + '}\n\nvoid actionsPress(uint8_t input, uint16_t now) {')
                replace(source,'src/actions.c','(uint16_t)(now - pendingSince) < chordWindow','chordWithinWindow(now, chordWindow)')
                replace(source,'src/actions.c','(uint16_t)(now - pendingSince) >= configChordWindowMs()',
                    '!chordWithinWindow(now, configChordWindowMs())')
            elif part=='release':
                replace(source,'src/actions.c','  if (input < configKeyCount() && chordPartner[input]) {\n    other = chordPartner[input] - 1;',
                    '  if (input < configKeyCount() && (other = chordPartner[input])) {\n    other--;')
            elif part=='links':
                replace(source,'src/actions.c','      pendingInput = 0;\n      chordPartner[other] = input + 1;\n      chordPartner[input] = other + 1;',
                    '      chordPartner[input] = pendingInput;\n      pendingInput = 0;\n      chordPartner[other] = input + 1;')
    elif name in ('mask-inverted','mask-release-byte','mask-release-local','mask-inverted-byte','mask-compact','mask-compact-do','mask-compact-register','mask-inline-time','mask-compact-unguarded'):
        edits('mask-narrow',source)
        parts={
            'mask-inverted':['inverted'],'mask-release-byte':['release-byte'],
            'mask-release-local':['release-local'],'mask-inverted-byte':['inverted','release-byte'],
            'mask-compact':['inverted','release-byte','release-local'],
            'mask-compact-do':['inverted','release-byte','release-local','do'],
            'mask-compact-register':['inverted','release-byte','release-local','register'],
            'mask-inline-time':['inline-time'],
            'mask-compact-unguarded':['inverted','release-byte','release-local','unguarded'],
        }[name]
        for part in parts:
            if part=='inverted':
                replace(source,'src/config.c','{3, 5, 6}','{252, 250, 249}')
                replace(source,'src/config.c','{3, 5, 9, 17, 33, 6, 10, 18, 34, 12, 20, 36, 24, 40, 48}',
                    '{252, 250, 246, 238, 222, 249, 245, 237, 221, 243, 235, 219, 231, 215, 207}')
                replace(source,'src/config.c','            if ((pair & inputs) == inputs) return offset + 1;',
                    '            if (!(pair & inputs)) return offset + 1;')
            elif part=='release-byte':
                replace(source,'src/actions.c','pendingInput == input + 1','pendingInput == (uint8_t)(input + 1)')
            elif part=='release-local':
                replace(source,'src/actions.c','__pdata uint8_t timedWork; // Shared interval/release-mask scratch.\n','')
                replace(source,'src/actions.c','  timedWork = 1 << input;\n  if (!(inputDown & timedWork)) return;\n  inputDown &= ~timedWork;',
                    '  uint8_t released = (uint8_t)(1u << input);\n  if (!(inputDown & released)) return;\n  inputDown &= ~released;')
            elif part=='do':
                replace(source,'src/config.c','    uint8_t offset = configLayerPaletteOffset(configLayerCount());',
                    '    uint8_t offset;\n    if (!count) return 0;\n    offset = configLayerPaletteOffset(configLayerCount());')
                replace(source,'src/config.c','    while (count--) {','    do {')
                replace(source,'src/config.c','        offset += 3;\n    }\n    return 0;','        offset += 3;\n    } while (--count);\n    return 0;')
            elif part=='register':
                replace(source,'platformio.ini','actionsLayer,actionsDropped','actionsLayer,actionsDropped,configLayerPaletteOffset')
            elif part=='inline-time':
                replace(source,'src/actions.c','(uint16_t)(now - pendingSince) < chordWindow',
                    '!((uint16_t)(now - pendingSince) >> 8) && (uint8_t)(now - pendingSince) < chordWindow')
                replace(source,'src/actions.c','(uint16_t)(now - pendingSince) >= configChordWindowMs()',
                    '((uint16_t)(now - pendingSince) >> 8) || (uint8_t)(now - pendingSince) >= configChordWindowMs()')
                # Preserve the original pending guard around the complete OR.
                replace(source,'src/actions.c','if (pendingInput && ((uint16_t)(now - pendingSince) >> 8) || (uint8_t)(now - pendingSince) >= configChordWindowMs())',
                    'if (pendingInput && (((uint16_t)(now - pendingSince) >> 8) || (uint8_t)(now - pendingSince) >= configChordWindowMs()))')
            elif part=='unguarded':edits('resolve-unguarded',source)
    elif name in ('compact-validator-byte','compact-validator-fold','compact-validator-signed','compact-bit-table','compact-bit-helper','compact-order-init'):
        edits('mask-compact-do',source)
        if name=='compact-validator-byte':
            replace(source,'src/config.c','        id = validationImage[offset];\n        if (((id >> 4) != 7 && (id >> 4) >= validationLayers)',
                '        id = validationImage[offset];\n        uint8_t scope = id >> 4;\n        if ((scope != 7 && scope >= validationLayers)')
        elif name=='compact-validator-fold':
            replace(source,'src/config.c','((id >> 4) != 7 && (id >> 4) >= validationLayers) ||\n            (id & 15) >= pairCount(variant)',
                '(uint8_t)(id & 0x8F) >= pairCount(variant) ||\n'
                '            ((uint8_t)(id & 0x70) != 0x70 && (uint8_t)(id & 0x70) >= (uint8_t)(validationLayers << 4))')
        elif name=='compact-validator-signed':
            replace(source,'src/config.c','    __idata uint8_t previous = 0;', '    __idata int8_t previous = -1;')
            replace(source,'src/config.c','(i && id <= previous)', '((int8_t)id <= previous)')
        elif name in ('compact-bit-table','compact-bit-helper'):
            p=source/'src/actions.c';s=p.read_text()
            helper='static const __code uint8_t inputBits[] = {1, 2, 4, 8, 16, 32, 64};\n' if name=='compact-bit-table' else 'static uint8_t inputBit(uint8_t input) { return (uint8_t)(1u << input); }\n'
            s=s.replace('void actionsPress(uint8_t input, uint16_t now) {',helper+'\nvoid actionsPress(uint8_t input, uint16_t now) {')
            for key in ('input','other'):
                expression='inputBits['+key+']' if name=='compact-bit-table' else 'inputBit('+key+')'
                s=s.replace('(uint8_t)(1u << '+key+')',expression).replace('(1u << '+key+')',expression)
            # Do not rewrite the helper's own shift into a recursive call.
            if name=='compact-bit-helper':s=s.replace('static uint8_t inputBit(uint8_t input) { return inputBit(input); }',helper.strip())
            p.write_text(s)
        elif name=='compact-order-init':
            replace(source,'src/actions.c','  for (i = 0; i < 6; i++) {\n    chordPartner[i] = 0;\n  }\n','')
            replace(source,'src/actions.c','    buttonPressed[i] = 0;\n    buttonOrder[i] = i;',
                '    if (i < 6) chordPartner[i] = 0;\n    buttonPressed[i] = 0;\n    buttonOrder[i] = i;')
    elif name in ('final-table','data-input','data-pending','data-clock','data-all','data-all-init'):
        edits('compact-bit-table',source)
        if name in ('final-table','data-all-init'):
            replace(source,'src/actions.c','  for (i = 0; i < 6; i++) {\n    chordPartner[i] = 0;\n  }\n','')
            replace(source,'src/actions.c','    buttonPressed[i] = 0;\n    buttonOrder[i] = i;',
                '    if (i < 6) chordPartner[i] = 0;\n    buttonPressed[i] = 0;\n    buttonOrder[i] = i;')
        if name in ('data-input','data-all','data-all-init'):
            replace(source,'src/actions.c','__pdata uint8_t inputDown;', '__data uint8_t inputDown;')
        if name in ('data-pending','data-all','data-all-init'):
            for item in ('uint8_t pendingInput;', 'uint8_t pendingLayer;', 'uint16_t pendingSince;'):
                replace(source,'src/actions.c','__pdata '+item,'__data '+item)
        if name=='data-clock':
            replace(source,'src/actions.c','__pdata uint16_t pendingSince;', '__data uint16_t pendingSince;')
    elif name != 'baseline':
        raise ValueError(name)


def blank(name):
    source = ART / name / 'source'
    if source.exists(): raise RuntimeError(f'Existing snapshot: {source}')
    source.mkdir(parents=True)
    for directory in ('src', 'tests', 'pio-platform'):
        shutil.copytree(ROOT / directory, source / directory)
    for filename in ('CH552_Universal_Macropad.ino', 'platformio.ini'):
        shutil.copyfile(ROOT / filename, source / filename)
    (source / 'webUploader').symlink_to(ROOT / 'webUploader', target_is_directory=True)
    return source


def save(name, source):
    for group, files in [('firmware', FILES), ('tests', ('tests/config_fixture.h','tests/run_host_tests.py',*(['tests/chord_lookup_test.c'] if name=='final' else [])))]:
        patch=[]
        for f in files:
            original=ART/'baseline/source'/f
            patch += difflib.unified_diff(original.read_text().splitlines(True) if original.exists() else [], (source/f).read_text().splitlines(True), fromfile='a/'+f if original.exists() else '/dev/null', tofile='b/'+f)
        (HERE/(name+('' if group=='firmware' else '-tests')+'.patch')).write_text(''.join(patch))
    (HERE/('source-'+name+'-sha256.json')).write_text(json.dumps({f:hashlib.sha256((source/f).read_bytes()).hexdigest() for f in FILES},indent=2)+'\n')


def main():
    names=sys.argv[1:] or ['baseline','global-byte','lookup-countdown','lookup-single-read','lookup-nibble','pair-inline','pair-table','validator-scope','validator-order','shared-dispatch','cached-mask','offset-pair','mask-lookup','mask-direct','resolve-unguarded','partner-internal','pending-internal','local-combined','mask-combined','mask-callee']
    sources={}
    for name in names:
        sources[name]=blank(name);edits(name,sources[name]);save(name,sources[name])
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows=list(pool.map(prior.build,[(n,s,v) for n,s in sources.items() for v in (0,1)]))
    destination=HERE/'results.json'
    if destination.exists(): rows=[r for r in json.loads(destination.read_text())['rows'] if r['candidate'] not in names]+rows
    destination.write_text(json.dumps(dict(baseline_revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),rows=rows),indent=2)+'\n')


if __name__=='__main__':main()
