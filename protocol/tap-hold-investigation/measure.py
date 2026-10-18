"""Prepare and measure isolated tap-hold candidates; never modify active firmware."""
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
ART = Path('/private/tmp/macropad-tap-hold')
FIRMWARE = ('src/config.h', 'src/config.c', 'src/actions.h', 'src/actions.c',
            'CH552_Universal_Macropad.ino', 'src/protocol_firmware.c')


def replace(source, filename, old, new):
    path = source / filename
    content = path.read_text()
    assert content.count(old) == 1, (filename, old, content.count(old))
    path.write_text(content.replace(old, new))


def prepare(name):
    source = ART / name / 'source'
    source.mkdir(parents=True, exist_ok=True)
    for directory in ('src', 'tests', 'pio-platform'):
        shutil.copytree(ROOT / directory, source / directory, dirs_exist_ok=True)
    for filename in ('CH552_Universal_Macropad.ino', 'platformio.ini'):
        shutil.copyfile(ROOT / filename, source / filename)
    if not (source / 'webUploader').exists():
        (source / 'webUploader').symlink_to(ROOT / 'webUploader', target_is_directory=True)
    if name == 'baseline':
        save(name, source)
        return source
    replace(source, 'src/config.h', '#define CONFIG_ACTION_RESERVED         0xF',
            '#define CONFIG_ACTION_TAP_HOLD         0xF\n#define CONFIG_ACTION_RESERVED         0xF')
    replace(source, 'src/config.h', '#define CONFIG_ACTION_MASK (0xFFFFu ^ (1u << CONFIG_ACTION_RESERVED))',
            '#define CONFIG_ACTION_MASK 0xFFFFu')
    replace(source, 'tests/protocol_test.c', 'sent[22] == 0x7F', 'sent[22] == 0xFF')
    replace(source, 'src/config.c', 'static const __xdata uint8_t *__data validationImage;',
            'static __data uint8_t validationTap, validationMacros;\n'
            'static const __xdata uint8_t *__data validationImage;')
    replace(source, 'src/config.c', '__idata uint8_t macros = validationPool + validationUsed;',
            '__idata uint8_t macros = validationMacros;')
    replace(source, 'src/config.c', '        case CONFIG_ACTION_MACRO:', '''        case CONFIG_ACTION_TAP_HOLD:
            return !rotation && param >= validationTap && param < validationMacros &&
                   !((param - validationTap) & 3);
        case CONFIG_ACTION_MACRO:''')
    replace(source, 'src/config.c', '    offset = 9;\n    for (layer', '''    // Optional counted pair block follows strings; ordinary profiles add nothing.
    validationTap = validationMacros = (uint8_t)end;
    if (end < CONFIG_SIZE && (validationImage[(uint8_t)end] & 15) == CONFIG_ACTION_TAP_HOLD) {
        validationTap++;
        end += 1 + 4 * ((validationImage[(uint8_t)end] >> 4) + 1);
        if (end > CONFIG_SIZE) return 0;
        validationMacros = (uint8_t)end;
    }
    for (offset = validationTap; offset < validationMacros; offset += 4) {
        // No recursive dual-role definitions, even in unreferenced pairs.
        if ((validationImage[offset] & 15) == CONFIG_ACTION_TAP_HOLD ||
            (validationImage[(uint8_t)(offset + 2)] & 15) == CONFIG_ACTION_TAP_HOLD ||
            !actionValid(offset, 1) || !actionValid(offset + 2, 0)) return 0;
    }
    offset = 9;
    for (layer''')
    replace(source, 'src/config.c', 'for (offset = validationPool + validationUsed; offset < CONFIG_SIZE; offset++)',
            'for (offset = validationMacros; offset < CONFIG_SIZE; offset++)')
    replace(source, 'tests/config_test.c', 'if (slot == 5) offset = pool + 4;',
            'if (slot == 5) offset = pool + 5; // Type F is only a prefix at the section start.')
    # The release clock is required to distinguish threshold crossings without a poll.
    for filename in ('src/actions.h', 'src/actions.c'):
        replace(source, filename, 'void actionsRelease(uint8_t input)',
                'void actionsRelease(uint8_t input, uint16_t now)')
    replace(source, 'CH552_Universal_Macropad.ino', 'actionsRelease(input);', 'actionsRelease(input, now);')
    for path in (source / 'tests').glob('*.[ch]'):
        content = path.read_text()
        content = re.sub(r'actionsRelease\(([^();]+)\)', r'actionsRelease(\1, 0)', content)
        path.write_text(content)
    replace(source, 'src/actions.c', '__pdata uint16_t pendingSince;',
            '__pdata uint16_t pendingSince;\n__xdata uint16_t tapSince[MAX_INPUTS];')
    replace(source, 'src/actions.c', '  __xdata uint8_t requestedSecond = second;',
            '  // A pending wrapper is not yet an executed action or a one-shot consumer.\n'
            '  if (actionType(first) == CONFIG_ACTION_TAP_HOLD) return;\n'
            '  __xdata uint8_t requestedSecond = second;')
    replace(source, 'src/actions.c', 'static void resolvePending(void) {', '''static FW_BIT tapExpired(uint8_t input, uint16_t now) {
  return (uint16_t)(now - tapSince[input]) >=
         ((uint16_t)((buttonFirst[input] >> 4) + 1) << 5);
}

static void resolveTap(uint8_t input, uint8_t branch) {
  uint8_t offset = buttonSecond[input] + branch;
  buttonFirst[input] = activeConfig[offset];
  buttonSecond[input] = activeConfig[(uint8_t)(offset + 1)];
  runAction(buttonFirst[input], buttonSecond[input], 0, input);
}

static void resolvePending(void) {''')
    replace(source, 'src/actions.c', '  inputDown |= 1 << input;',
            '  inputDown |= 1 << input;\n  tapSince[input] = now;')
    replace(source, 'src/actions.c', '      pendingInput = 0;\n      chordPartner[other]',
            '      pendingInput = 0;\n      tapSince[other] = now; // Chord duration starts at recognition.\n      chordPartner[other]')
    replace(source, 'src/actions.c', 'static void releaseAction(uint8_t input) {',
            'static void releaseAction(uint8_t input, uint16_t now) {\n'
            '  if (buttonPressed[input] && actionType(buttonFirst[input]) == CONFIG_ACTION_TAP_HOLD)\n'
            '    resolveTap(input, tapExpired(input, now) ? 2 : 0);')
    replace(source, 'src/actions.c', '  releaseAction(input);', '  releaseAction(input, now);')
    replace(source, 'src/actions.c', '    releaseAction(other);', '    releaseAction(other, now);')
    replace(source, 'src/actions.c', '  i = USB_reportGeneration();', '''  // Resolve before transport backpressure can postpone the hold decision.
  for (i = 0; i < MAX_INPUTS; i++) {
    if (buttonPressed[i] == 1 && actionType(buttonFirst[i]) == CONFIG_ACTION_TAP_HOLD &&
        tapExpired(i, now)) {
      resolveTap(i, 2);
      updateLayer();
    }
  }
  i = USB_reportGeneration();''')
    if name != 'initial':
        optimize(name, source)
    save(name, source)
    return source


def normalize_before_scan(source):
    path = source / 'src/actions.c'
    content = path.read_text()
    start = content.index('  if (pendingInput && (uint16_t)(now - pendingSince) >= configChordWindowMs()) {')
    end = content.index('  i = USB_reportGeneration();', start)
    body = content[start:end]
    content = content[:start] + '  actionsResolveInputs(now);\n' + content[end:]
    at = content.index('void actionsPoll(uint16_t now) {')
    content = content[:at] + 'void actionsResolveInputs(uint16_t now) {\n  uint8_t i;\n' + body + '}\n\n' + content[at:]
    path.write_text(content)
    replace(source, 'src/actions.h', 'void actionsPoll(uint16_t now);',
            'void actionsPoll(uint16_t now);\nvoid actionsResolveInputs(uint16_t now);')
    replace(source, 'CH552_Universal_Macropad.ino', '  for (uint8_t i = 0; i <= NUM_LEDS; i++) {\n    scanButton',
            '  if (activeConfigValid) actionsResolveInputs(now);\n  for (uint8_t i = 0; i <= NUM_LEDS; i++) {\n    scanButton')


def optimize(name, source):
    if name in ('complete-small', 'complete-stack', 'complete-combined', 'complete-small-combined'):
        optimize('end-aligned-small' if name in ('complete-small', 'complete-small-combined') else 'end-aligned-stack', source)
        # Recompute layers while the chosen branch is still physically held, including
        # a release exactly on the threshold with no prior output poll.
        replace(source, 'src/actions.c', '''  runAction(buttonFirst[input], buttonSecond[input], 0, input);
}

static void resolvePending''', '''  runAction(buttonFirst[input], buttonSecond[input], 0, input);
  updateLayer();
}

static void resolvePending''')
        replace(source, 'src/actions.c', '      resolveTap(i, 2);\n      updateLayer();', '      resolveTap(i, 2);')
        if name.endswith('combined'):
            result = subprocess.run(['git', 'apply', '--unsafe-paths', '--exclude=src/actions.h',
                                     str(ROOT / 'protocol/hid-layer-investigation/recommended.patch')],
                                    cwd=source, capture_output=True, text=True)
            if result.returncode: raise RuntimeError(result.stderr)
            replace(source, 'src/actions.h', 'uint8_t actionsLayer(void);',
                    'uint8_t actionsLayer(void);\nvoid actionsSetLayer(uint8_t options);')
            for path in (source / 'tests').glob('*.c'):
                content = path.read_text()
                content = re.sub(r'actionsRelease\(([^();,]+)\)', r'actionsRelease(\1, 0)', content)
                path.write_text(content)
        return
    if name in ('end-aligned', 'end-aligned-stack', 'final-combined', 'end-aligned-small'):
        optimize('byte-count', source)
        replace(source, 'src/config.c', 'static __data uint8_t validationTap, validationMacros;',
                'static __data uint8_t validationMacros;')
        replace(source, 'src/config.c', '''            return !rotation && param >= validationTap && param < validationMacros &&
                   !((uint8_t)(param - validationTap) & 3);''', '''            return !rotation && param > (uint8_t)(validationPool + validationUsed) && param < macros &&
                   !((param ^ macros) & 3);''')
        replace(source, 'src/config.c', '    validationTap = validationMacros = (uint8_t)end;',
                '    validationMacros = (uint8_t)end;')
        replace(source, 'src/config.c', '        validationTap++;\n', '')
        replace(source, 'src/config.c', '    for (offset = validationTap; offset < CONFIG_SIZE; offset++) {',
                '    offset = validationPool + validationUsed;\n'
                '    if (offset < validationMacros) offset++; // Skip the optional prefix.\n'
                '    for (; offset < CONFIG_SIZE; offset++) {')
        replace(source, 'src/config.c', '!((uint8_t)(offset - validationTap) & 2)',
                '!((offset ^ validationMacros) & 2)')
        if name in ('end-aligned-stack', 'final-combined'):
            replace(source, 'src/config.c', 'static __data uint8_t validationMacros;',
                    'static __xdata uint8_t validationMacros;')
            replace(source, 'src/actions.c', '__idata uint16_t tapNow;', '__xdata uint16_t tapNow;')
            replace(source, 'src/actions.c', 'resolveTap(uint8_t input, uint8_t branch)',
                    'resolveTap(uint8_t input, __xdata uint8_t branch)')
        if name == 'end-aligned-small':
            replace(source, 'src/actions.c', '''  return (uint16_t)(tapNow - tapSince[input]) >=
         (((uint16_t)(buttonFirst[input] & 0xF0) << 1) + 32);''', '''  uint16_t elapsed = tapNow - tapSince[input];
  return (elapsed >> 5) > (buttonFirst[input] >> 4);''')
        if name == 'final-combined':
            result = subprocess.run(['git', 'apply', '--unsafe-paths', '--exclude=src/actions.h', str(ROOT / 'protocol/hid-layer-investigation/recommended.patch')],
                                    cwd=source, capture_output=True, text=True)
            if result.returncode: raise RuntimeError(result.stderr)
            replace(source, 'src/actions.h', 'uint8_t actionsLayer(void);',
                    'uint8_t actionsLayer(void);\nvoid actionsSetLayer(uint8_t options);')
            for path in (source / 'tests').glob('*.c'):
                content = path.read_text()
                content = re.sub(r'actionsRelease\(([^();,]+)\)', r'actionsRelease(\1, 0)', content)
                path.write_text(content)
        return
    if name in ('stack-final', 'byte-count', 'split-clock', 'dispatch-type'):
        optimize('one-loop', source)
        replace(source, 'src/actions.c', '__xdata uint16_t tapSince[MAX_INPUTS];',
                '__xdata uint16_t tapSince[PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 4 : 7];')
        if name == 'stack-final':
            replace(source, 'src/config.c', 'static __data uint8_t validationTap, validationMacros;',
                    'static __xdata uint8_t validationTap, validationMacros;')
            replace(source, 'src/config.c', '''            return !rotation && param >= validationTap && param < validationMacros &&
                   !((uint8_t)(param - validationTap) & 3);''', '''            if (rotation || param < validationTap || param >= macros) return 0;
            param -= validationTap;
            return !(param & 3);''')
            replace(source, 'src/config.c', '    validationTap = validationMacros = (uint8_t)end;',
                    '    offset = (uint8_t)end;')
            replace(source, 'src/config.c', '        validationTap++;', '        offset++;')
            replace(source, 'src/config.c', '        validationMacros = (uint8_t)end;\n    }',
                    '    }\n    validationTap = offset;\n    validationMacros = (uint8_t)end;')
            replace(source, 'src/actions.c', '__idata uint16_t tapNow;', '__xdata uint16_t tapNow;')
            replace(source, 'src/actions.c', 'resolveTap(uint8_t input, uint8_t branch)',
                    'resolveTap(uint8_t input, __xdata uint8_t branch)')
        if name == 'byte-count':
            replace(source, 'src/config.c', '''        validationTap++;
        end += (uint8_t)(5 + (uint8_t)((validationImage[(uint8_t)end] >> 4) << 2));
        if (end > CONFIG_SIZE) return 0;
        validationMacros = (uint8_t)end;''', '''        validationTap++;
        offset = (uint8_t)(5 + (uint8_t)((validationImage[(uint8_t)end] >> 4) << 2));
        // Both terms are <=128/65 respectively; their sum cannot wrap a byte.
        validationMacros = (uint8_t)end + offset;
        if (validationMacros > CONFIG_SIZE) return 0;''')
        if name == 'split-clock':
            replace(source, 'src/actions.c', '''  return (uint16_t)(tapNow - tapSince[input]) >=
         (((uint16_t)(buttonFirst[input] & 0xF0) << 1) + 32);''', '''  uint16_t elapsed = tapNow - tapSince[input];
  return (elapsed >> 5) > (buttonFirst[input] >> 4);''')
        if name == 'dispatch-type':
            replace(source, 'src/actions.c', '''  if (actionType(first) == CONFIG_ACTION_TAP_HOLD) return;''',
                    '  uint8_t type = actionType(first);\n  if (type == CONFIG_ACTION_TAP_HOLD) return;')
            replace(source, 'src/actions.c', '  uint8_t type = actionType(first);\n  if (type == CONFIG_ACTION_LED_CONTROL)',
                    '  if (type == CONFIG_ACTION_LED_CONTROL)')
        return
    if name in ('precheck-good', 'inline-expiry', 'stack-safe', 'one-loop'):
        optimize('direct-state', source)
        normalize_before_scan(source)
        if name == 'inline-expiry':
            path = source / 'src/actions.c'
            text = path.read_text()
            a = text.index('static FW_BIT tapExpired(')
            b = text.index('static void resolveTap(', a)
            text = text[:a] + '#define tapExpired(input) ((uint16_t)(tapNow - tapSince[input]) >= (((uint16_t)(buttonFirst[input] & 0xF0) << 1) + 32))\n\n' + text[b:]
            path.write_text(text)
        if name == 'stack-safe':
            replace(source, 'src/config.c', 'static __data uint8_t validationTap, validationMacros;',
                    'static __xdata uint8_t validationTap, validationMacros;')
            replace(source, 'src/config.c', '''            return !rotation && param >= validationTap && param < validationMacros &&
                   !((uint8_t)(param - validationTap) & 3);''', '''            if (rotation || param < validationTap || param >= macros) return 0;
            param -= validationTap;
            return !(param & 3);''')
            replace(source, 'src/actions.c', '__idata uint16_t tapNow;', '__xdata uint16_t tapNow;')
            replace(source, 'src/actions.c', 'resolveTap(uint8_t input, uint8_t branch)',
                    'resolveTap(uint8_t input, __xdata uint8_t branch)')
        if name == 'one-loop':
            path = source / 'src/config.c'
            text = path.read_text()
            a = text.index('    for (offset = validationTap; offset < validationMacros; offset += 2) {')
            b = text.index('    offset = 9;', a)
            text = text[:a] + text[b:]
            old = '''    for (offset = validationMacros; offset < CONFIG_SIZE; offset++) {
        if (!validationImage[offset]) continue;
        if (offset == CONFIG_SIZE - 1 || !actionValid(offset, 2)) return 0;
        offset++;
    }'''
            new = '''    for (offset = validationTap; offset < CONFIG_SIZE; offset++) {
        if (offset < validationMacros) {
            if ((validationImage[offset] & 15) == CONFIG_ACTION_TAP_HOLD ||
                !actionValid(offset, !((uint8_t)(offset - validationTap) & 2))) return 0;
        } else {
            if (!validationImage[offset]) continue;
            if (offset == CONFIG_SIZE - 1 || !actionValid(offset, 2)) return 0;
        }
        offset++;
    }'''
            assert text.count(old) == 1
            path.write_text(text.replace(old, new))
        return
    if name == 'ram':
        for filename in ('src/actions.c', 'src/actions.h'):
            replace(source, filename, 'actionsRelease(uint8_t input, uint16_t now)',
                    'actionsRelease(uint8_t input, __xdata uint16_t now)')
        replace(source, 'src/actions.c', 'releaseAction(uint8_t input, uint16_t now)',
                'releaseAction(uint8_t input, __xdata uint16_t now)')
        replace(source, 'src/actions.c', 'tapExpired(uint8_t input, uint16_t now)',
                'tapExpired(uint8_t input, __xdata uint16_t now)')
        replace(source, 'src/actions.c', 'resolveTap(uint8_t input, uint8_t branch)',
                'resolveTap(uint8_t input, __xdata uint8_t branch)')
        return
    if name in ('shared-clock', 'narrow', 'combined-loop', 'fixed-clock', 'external-state', 'precheck', 'direct-state'):
        replace(source, 'src/actions.c', '__xdata uint16_t tapSince[MAX_INPUTS];',
                '__xdata uint16_t tapSince[MAX_INPUTS];\n__idata uint16_t tapNow;')
        replace(source, 'src/actions.c', 'tapExpired(uint8_t input, uint16_t now)', 'tapExpired(uint8_t input)')
        replace(source, 'src/actions.c', '(uint16_t)(now - tapSince[input])', '(uint16_t)(tapNow - tapSince[input])')
        replace(source, 'src/actions.c', 'tapExpired(input, now)', 'tapExpired(input)')
        replace(source, 'src/actions.c', 'tapExpired(i, now)', 'tapExpired(i)')
        replace(source, 'src/actions.c', 'releaseAction(uint8_t input, uint16_t now)', 'releaseAction(uint8_t input)')
        replace(source, 'src/actions.c', 'releaseAction(input, now)', 'releaseAction(input)')
        replace(source, 'src/actions.c', 'releaseAction(other, now)', 'releaseAction(other)')
        replace(source, 'src/actions.c', 'void actionsRelease(uint8_t input, uint16_t now) {',
                'void actionsRelease(uint8_t input, uint16_t now) {\n  tapNow = now;')
        replace(source, 'src/actions.c', '  // Resolve before transport backpressure',
                '  tapNow = now;\n  // Resolve before transport backpressure')
        replace(source, 'src/config.c', 'static __data uint8_t validationTap, validationMacros;',
                'static __idata uint8_t validationTap, validationMacros;')
    else:
        raise ValueError(name)
    if name in ('narrow', 'combined-loop', 'fixed-clock', 'external-state', 'precheck', 'direct-state'):
        replace(source, 'src/config.c', '!((param - validationTap) & 3)', '!((uint8_t)(param - validationTap) & 3)')
        replace(source, 'src/actions.c', '((uint16_t)((buttonFirst[input] >> 4) + 1) << 5)',
                '(((uint16_t)(buttonFirst[input] & 0xF0) << 1) + 32)')
        replace(source, 'src/config.c', 'end += 1 + 4 * ((validationImage[(uint8_t)end] >> 4) + 1);',
                'end += (uint8_t)(5 + (uint8_t)((validationImage[(uint8_t)end] >> 4) << 2));')
    if name in ('combined-loop', 'external-state', 'precheck', 'direct-state'):
        replace(source, 'src/config.c', '''    for (offset = validationTap; offset < validationMacros; offset += 4) {
        // No recursive dual-role definitions, even in unreferenced pairs.
        if ((validationImage[offset] & 15) == CONFIG_ACTION_TAP_HOLD ||
            (validationImage[(uint8_t)(offset + 2)] & 15) == CONFIG_ACTION_TAP_HOLD ||
            !actionValid(offset, 1) || !actionValid(offset + 2, 0)) return 0;
    }''', '''    for (offset = validationTap; offset < validationMacros; offset += 2) {
        // Alternating tap/hold contexts; reject nesting before the shared validator.
        if ((validationImage[offset] & 15) == CONFIG_ACTION_TAP_HOLD ||
            !actionValid(offset, !((uint8_t)(offset - validationTap) & 2))) return 0;
    }''')
    if name in ('external-state', 'precheck'):
        replace(source, 'src/config.c', 'static __idata uint8_t validationTap, validationMacros;',
                'static __xdata uint8_t validationTap, validationMacros;')
        replace(source, 'src/actions.c', '__idata uint16_t tapNow;', '__xdata uint16_t tapNow;')
        replace(source, 'src/actions.c', 'resolveTap(uint8_t input, uint8_t branch)',
                'resolveTap(uint8_t input, __xdata uint8_t branch)')
    if name == 'direct-state':
        # Restore direct validation addressing, while spilling the new release parameter.
        replace(source, 'src/config.c', 'static __idata uint8_t validationTap, validationMacros;',
                'static __data uint8_t validationTap, validationMacros;')
        for filename in ('src/actions.c', 'src/actions.h'):
            replace(source, filename, 'actionsRelease(uint8_t input, uint16_t now)',
                    'actionsRelease(uint8_t input, __xdata uint16_t now)')
    if name == 'precheck':
        # Normalize due chord singles and dual-role holds before a new physical input.
        path = source / 'src/actions.c'
        content = path.read_text()
        start = content.index('  if (pendingInput && (uint16_t)(now - pendingSince) >= configChordWindowMs()) {')
        end = content.index('  i = USB_reportGeneration();', start)
        body = content[start:end]
        content = content[:start] + '  actionsResolveInputs(now);\n' + content[end:]
        at = content.index('void actionsPoll(uint16_t now) {')
        content = content[:at] + 'void actionsResolveInputs(uint16_t now) {\n  uint8_t i;\n' + body + '}\n\n' + content[at:]
        path.write_text(content)
        replace(source, 'src/actions.h', 'void actionsPoll(uint16_t now);',
                'void actionsPoll(uint16_t now);\nvoid actionsResolveInputs(uint16_t now);')
        replace(source, 'CH552_Universal_Macropad.ino', '  for (uint8_t i = 0; i <= NUM_LEDS; i++) {\n    scanButton',
                '  if (activeConfigValid) actionsResolveInputs(now);\n  for (uint8_t i = 0; i <= NUM_LEDS; i++) {\n    scanButton')
    if name == 'fixed-clock':
        replace(source, 'src/actions.c', '(((uint16_t)(buttonFirst[input] & 0xF0) << 1) + 32)', '200')


def save(name, source):
    for group, filenames in [('firmware', FIRMWARE), ('tests', tuple(sorted({
            'tests/run_host_tests.py',
            *(str(p.relative_to(ROOT)) for p in (ROOT / 'tests').glob('*.[ch]')),
            *(str(p.relative_to(source)) for p in (source / 'tests').glob('*.[ch]'))})))]:
        patch = []
        for filename in filenames:
            original = ROOT / filename
            patch += list(difflib.unified_diff(original.read_text().splitlines(True) if original.exists() else [],
                (source / filename).read_text().splitlines(True),
                fromfile='a/' + filename if original.exists() else '/dev/null', tofile='b/' + filename))
        (HERE / (name + ('' if group == 'firmware' else '-tests') + '.patch')).write_text(''.join(patch))
    manifest = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(source.rglob('*')) if p.is_file() and '__pycache__' not in p.parts
                and 'webUploader' not in p.parts}
    (HERE / ('source-' + name + '-sha256.json')).write_text(json.dumps(manifest, indent=2) + '\n')


def build(job):
    name, source, variant = job
    output = ART / name / ('three' if variant else 'six')
    def invoke(limit):
        command = [sys.executable, str(ROOT / 'pio-platform/build_firmware.py'), 'build',
                   str(source), str(output), '24000000', '148', str(limit), str(variant)]
        result = subprocess.run(command, capture_output=True, text=True)
        return result
    result = invoke(14336)
    real_result = result.returncode
    if result.returncode and (output / 'firmware.mem').exists():
        # A relaxed diagnostic link measures an oversized candidate and runs layout checks.
        # Its HEX is not an installable CH552 image.
        result = invoke(65535)
    if result.returncode and not (output / 'firmware.mem').exists():
        raise RuntimeError(result.stdout[-3000:] + result.stderr[-3000:])
    mem = (output / 'firmware.mem').read_text()
    def size(label):
        return int(re.search(rf'{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)', mem)[1])
    row = dict(candidate=name, variant=variant, flash=size('ROM/EPROM/FLASH'),
               paged=size('PAGED EXT. RAM'), external=size('EXTERNAL RAM'),
               stack=int(re.search(r'with (\d+) bytes available', mem)[1]),
               real_limit_returncode=real_result, diagnostic_link=bool(real_result),
               layout_checks='failed' if result.returncode else 'passed', artifacts=str(output),
               error=result.stderr[-5000:] if result.returncode else '',
               hex_sha256=hashlib.sha256((output / 'firmware.hex').read_bytes()).hexdigest()
                   if not result.returncode else None)
    row['free'] = 14336 - row['flash']
    shutil.copyfile(output / 'firmware.mem', HERE / (name + '-' + str(variant) + '.mem'))
    print(json.dumps({k: v for k, v in row.items() if k != 'error'}), flush=True)
    return row


def main():
    names = [n for n in sys.argv[1:] if not n.startswith('--')] or ['baseline', 'initial']
    sources = {name: prepare(name) for name in names}
    if '--prepare-only' in sys.argv:
        return
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(build, [(n, s, v) for n, s in sources.items() for v in (0, 1)]))
    dest = HERE / 'results.json'
    if dest.exists():
        rows = [r for r in json.loads(dest.read_text())['rows'] if r['candidate'] not in names] + rows
    dest.write_text(json.dumps(dict(baseline_revision=subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), rows=rows), indent=2) + '\n')


if __name__ == '__main__':
    main()
