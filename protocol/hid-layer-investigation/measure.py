"""Build isolated HID layer-command candidates without changing active firmware."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import difflib
import hashlib
import json
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ARTIFACTS = Path('/private/tmp/macropad-hid-layer')
FILES = ('src/actions.c', 'src/actions.h', 'src/protocol_firmware.c', 'src/timed_actions.inc')


def replace(source, filename, old, new):
    path = source / filename
    text = path.read_text()
    assert text.count(old) == 1, (filename, old)
    path.write_text(text.replace(old, new))


def prepare(name):
    candidate = name
    source = ARTIFACTS / name / 'source'
    if name.startswith('opt-'):
        name = 'shared-reset-wake'
    input_mode = candidate.startswith('input') or candidate.startswith('optional-input')
    if input_mode:
        name = 'shared-basic'
    source.mkdir(parents=True, exist_ok=True)
    for directory in ('src', 'tests', 'pio-platform'):
        shutil.copytree(ROOT / directory, source / directory, dirs_exist_ok=True)
    for filename in ('CH552_Universal_Macropad.ino', 'platformio.ini'):
        shutil.copyfile(ROOT / filename, source / filename)
    if not (source / 'webUploader').exists():
        (source / 'webUploader').symlink_to(ROOT / 'webUploader', target_is_directory=True)
    if name != 'baseline':
        wake = name != 'basic'
        replace(source, 'src/actions.h', 'uint8_t actionsLayer(void);',
                'uint8_t actionsLayer(void);\n'
                'void actionsSetLayer(uint8_t layer' + (', uint8_t wake' if wake else '') + ');')
        helper = '''void actionsSetLayer(uint8_t layer%s) {
  uint8_t previous = oneShotReturnLayer == 0xFF ? baseLayer : oneShotReturnLayer;
  if (layer != previous) previousLayer = previous;
  oneShotReturnLayer = 0xFF;
  baseLayer = layer;
  layerSelectionPending = 1;
  updateLayer();
%s}

''' % (', uint8_t wake' if wake else '', '''  if (wake) {
    uint8_t slot = configTimedCount();
    timedAge[slot] = 0;
    timedFraction[slot] = 0;
    if (timedHigh[slot] & 1) firmwareLedAction(LED_SLEEP_RESTORE, 0);
    timedHigh[slot] = 0;
  }
''' if wake else '')
        replace(source, 'src/actions.c', 'void actionsInit(void) {', helper + 'void actionsInit(void) {')
        replace(source, 'src/protocol_firmware.c', '#define PROTOCOL_GET_TIMERS 12',
                '#define PROTOCOL_GET_TIMERS 12\n#define PROTOCOL_SET_LAYER 13')
        replace(source, 'src/protocol_firmware.c',
                '(offset && opcode != PROTOCOL_PREVIEW_COLOR)',
                '(offset && opcode != PROTOCOL_PREVIEW_COLOR && opcode != PROTOCOL_SET_LAYER)')
        case = '''    case PROTOCOL_SET_LAYER:
      if (!activeConfigValid) return PROTOCOL_BAD_CONFIG;
      if (%s >= configLayerCount()) return PROTOCOL_BAD_RANGE;
      actionsSetLayer(%s);
      break;
''' % ('(offset & 0x7F)' if wake else 'offset',
       'offset & 0x7F, offset & 0x80' if wake else 'offset')
        replace(source, 'src/protocol_firmware.c', '    case PROTOCOL_ENTER_BOOTLOADER:',
                case + '    case PROTOCOL_ENTER_BOOTLOADER:')
        replace(source, 'tests/protocol_test.c', 'uint8_t actionsLayer(void) { return configStartupLayer(); }',
                'uint8_t actionsLayer(void) { return configStartupLayer(); }\n'
                'void actionsSetLayer(uint8_t layer' + (', uint8_t wake' if wake else '') + ') {\n'
                '    (void)layer;' + (' (void)wake;' if wake else '') + '\n}\n')
        if name in ('narrow-wake', 'packed-wake', 'packed-first-wake', 'shared-wake', 'shared-basic', 'shared-reset-wake'):
            replace(source, 'src/protocol_firmware.c', '(offset & 0x7F) >= configLayerCount()',
                    '(uint8_t)(offset & 0x7F) >= configLayerCount()')
        if name in ('packed-wake', 'packed-first-wake', 'shared-wake', 'shared-basic', 'shared-reset-wake'):
            for filename in ('src/actions.h', 'tests/protocol_test.c'):
                replace(source, filename, 'uint8_t layer, uint8_t wake', 'uint8_t options')
            replace(source, 'tests/protocol_test.c', '(void)layer; (void)wake;', '(void)options;')
            replace(source, 'src/protocol_firmware.c', 'actionsSetLayer(offset & 0x7F, offset & 0x80);',
                    'actionsSetLayer(offset);')
            replace(source, 'src/actions.c', 'void actionsSetLayer(uint8_t layer, uint8_t wake) {',
                    'void actionsSetLayer(uint8_t options) {\n  uint8_t layer = options & 0x7F;')
            replace(source, 'src/actions.c', '  if (wake) {', '  if (options & 0x80) {')
            replace(source, 'src/actions.c',
                    '    if (timedHigh[slot] & 1) firmwareLedAction(LED_SLEEP_RESTORE, 0);\n'
                    '    timedHigh[slot] = 0;',
                    '    uint8_t pending = timedHigh[slot] & 1;\n'
                    '    timedHigh[slot] = 0;\n'
                    '    if (pending) firmwareLedAction(LED_SLEEP_RESTORE, 0);')
            if name == 'packed-first-wake':
                path = source / 'src/actions.c'
                text = path.read_text()
                start = text.index('  if (options & 0x80) {')
                end = text.index('\n  }', start) + len('\n  }\n')
                block = text[start:end]
                text = text[:start] + text[end:]
                position = text.index('  uint8_t previous = oneShotReturnLayer')
                path.write_text(text[:position] + block + text[position:])
        if name in ('shared-wake', 'shared-basic', 'shared-reset-wake'):
            replace(source, 'src/actions.c', 'static void updateLayer(void);',
                    '''static void selectBaseLayer(uint8_t layer) {
  uint8_t previous = oneShotReturnLayer == 0xFF ? baseLayer : oneShotReturnLayer;
  if (layer != previous) previousLayer = previous;
  baseLayer = layer;
}

static void updateLayer(void);''')
            replace(source, 'src/actions.c',
                    '''    } else {
      selectedLayer = oneShotReturnLayer == 0xFF ? baseLayer : oneShotReturnLayer;
      if (second != selectedLayer) previousLayer = selectedLayer;
    }
    baseLayer = second;''',
                    '''      baseLayer = second;
    } else selectBaseLayer(second);''')
            replace(source, 'src/actions.c',
                    '''  uint8_t previous = oneShotReturnLayer == 0xFF ? baseLayer : oneShotReturnLayer;
  if (layer != previous) previousLayer = previous;
  oneShotReturnLayer = 0xFF;
  baseLayer = layer;''',
                    '''  selectBaseLayer(layer);
  oneShotReturnLayer = 0xFF;''')
            if name == 'shared-basic':
                path = source / 'src/actions.c'
                text = path.read_text()
                start = text.index('  if (options & 0x80) {')
                end = text.index('\n  }', start) + len('\n  }\n')
                path.write_text(text[:start] + text[end:])
                replace(source, 'src/protocol_firmware.c',
                        '(uint8_t)(offset & 0x7F) >= configLayerCount()', 'offset >= configLayerCount()')
            if name == 'shared-reset-wake':
                replace(source, 'src/actions.c', 'static void resetLayerTimers(void);',
                        'static void resetLayerTimers(void);\nstatic void wakeAutoSleep(void);')
                path = source / 'src/actions.c'
                text = path.read_text()
                start = text.index('  if (options & 0x80) {')
                end = text.index('\n  }', start) + len('\n  }\n')
                path.write_text(text[:start] + '  if (options & 0x80) wakeAutoSleep();\n' + text[end:])
                replace(source, 'src/timed_actions.inc', 'static void resetLayerTimers(void) {',
                        '''static void wakeAutoSleep(void) {
  uint8_t slot = configTimedCount();
  uint8_t pending = timedHigh[slot] & 1;
  timedAge[slot] = 0;
  timedFraction[slot] = 0;
  timedHigh[slot] = 0;
  if (pending) firmwareLedAction(LED_SLEEP_RESTORE, 0);
}

static void resetLayerTimers(void) {''')
                replace(source, 'src/timed_actions.inc',
                        '      if (configLayerOptions(effectiveLayer) & CONFIG_LAYER_OPT_AUTO_SLEEP) return;',
                        '''      if (!(configLayerOptions(effectiveLayer) & CONFIG_LAYER_OPT_AUTO_SLEEP)) wakeAutoSleep();
      return;''')
                replace(source, 'src/timed_actions.inc',
                        '''  // The shared reset retained only the pending bit; clear it before restoring
  // lighting so this transition cannot consume the next physical input.
  if (timedHigh[count]) {
    timedHigh[count] = 0;
    firmwareLedAction(LED_SLEEP_RESTORE, 0);
  }
''', '')
    if candidate.startswith('opt-'):
        replace(source, 'src/protocol_firmware.c',
                '      if ((uint8_t)(offset & 0x7F) >= configLayerCount()) return PROTOCOL_BAD_RANGE;',
                '      i = configLayerCount();\n'
                '      if ((uint8_t)(offset & 0x7F) >= i) return PROTOCOL_BAD_RANGE;')
        if candidate in ('opt-early', 'opt-all', 'opt-final'):
            path = source / 'src/protocol_firmware.c'
            text = path.read_text()
            start = text.index('    case PROTOCOL_SET_LAYER:')
            end = text.index('    case PROTOCOL_ENTER_BOOTLOADER:', start)
            case = text[start:end].replace('    case PROTOCOL_SET_LAYER:',
                    '  if (opcode == PROTOCOL_SET_LAYER) {\n      if (length) return PROTOCOL_BAD_RANGE;')
            case = case.replace('      break;\n', '      return PROTOCOL_OK;\n  }\n')
            text = text[:start] + text[end:]
            text = text.replace(' && opcode != PROTOCOL_SET_LAYER', '')
            insert = text.index('  if (opcode == PROTOCOL_READ_FLASH')
            path.write_text(text[:insert] + case + text[insert:])
        if candidate in ('opt-slot', 'opt-all', 'opt-final'):
            replace(source, 'src/actions.c', 'static void wakeAutoSleep(void);',
                    'static void wakeAutoSleep(uint8_t slot);')
            replace(source, 'src/actions.c', 'wakeAutoSleep();', 'wakeAutoSleep(configTimedCount());')
            replace(source, 'src/timed_actions.inc',
                    'static void wakeAutoSleep(void) {\n  uint8_t slot = configTimedCount();',
                    'static void wakeAutoSleep(uint8_t slot) {')
            replace(source, 'src/timed_actions.inc', 'wakeAutoSleep();', 'wakeAutoSleep(count);')
        if candidate in ('opt-bit', 'opt-all', 'opt-final'):
            replace(source, 'src/timed_actions.inc', 'uint8_t pending = timedHigh[slot] & 1;',
                    'ACTION_BIT pending = timedHigh[slot] & 1;')
        if candidate == 'opt-final':
            replace(source, 'src/timed_actions.inc',
                    '''  for (uint8_t i = 0; i <= count; i++, offset += CONFIG_TIMED_SIZE) {
    if (i == count) {
      // Enabled layers preserve sleep time and any pending physical wake.
      if (!(configLayerOptions(effectiveLayer) & CONFIG_LAYER_OPT_AUTO_SLEEP)) wakeAutoSleep(count);
      return;
    } else if (!(activeConfig[offset] & 7)) continue;''',
                    '''  for (uint8_t i = 0; i < count; i++, offset += CONFIG_TIMED_SIZE) {
    if (!(activeConfig[offset] & 7)) continue;''')
            path = source / 'src/timed_actions.inc'
            text = path.read_text()
            position = text.rindex('    timedFraction[i] = 0;\n  }\n}\n')
            path.write_text(text[:position] + '''    timedFraction[i] = 0;
  }
  // Enabled layers preserve sleep time and any pending physical wake.
  if (!(configLayerOptions(effectiveLayer) & CONFIG_LAYER_OPT_AUTO_SLEEP)) wakeAutoSleep(count);
}
''')
    if input_mode:
        optional = candidate.startswith('optional-')
        replace(source, 'src/actions.c', '  selectBaseLayer(layer);',
                ('  if ((options & 0x80) && actionsTimedInput()) return;\n' if optional else
                 '  if (actionsTimedInput()) return;\n') + '  selectBaseLayer(layer);')
        replace(source, 'src/protocol_firmware.c',
                '      if (offset >= configLayerCount()) return PROTOCOL_BAD_RANGE;',
                '      i = configLayerCount();\n'
                '      if (' + ('(uint8_t)(offset & 0x7F)' if optional else 'offset') +
                ' >= i) return PROTOCOL_BAD_RANGE;')
        if candidate.endswith(('-inline', '-both')):
            replace(source, 'src/protocol_firmware.c', '      i = configLayerCount();',
                    '      i = (activeConfig[CONFIG_HEADER_LAYERS] >> 1) & 7;')
            replace(source, 'src/protocol_firmware.c',
                    ('(uint8_t)(offset & 0x7F)' if optional else 'offset') + ' >= i',
                    ('(uint8_t)(offset & 0x7F)' if optional else 'offset') + ' > i')
        if candidate.endswith(('-mask', '-both')):
            replace(source, 'src/protocol_firmware.c',
                    'opcode != PROTOCOL_PREVIEW_COLOR && opcode != PROTOCOL_SET_LAYER',
                    '(opcode & 0xFB) != PROTOCOL_PREVIEW_COLOR')
        if candidate.endswith('-clean'):
            if not optional:
                replace(source, 'src/actions.c', '  uint8_t layer = options & 0x7F;',
                        '  uint8_t layer = options;')
            replace(source, 'src/actions.c', 'void actionsSetLayer(uint8_t options) {\n  uint8_t layer = ' +
                    ('options & 0x7F;' if optional else 'options;'),
                    'void actionsSetLayer(uint8_t options) {')
            replace(source, 'src/actions.c', '  selectBaseLayer(layer);',
                    '  selectBaseLayer(' + ('options & 0x7F' if optional else 'options') + ');')
        if candidate.endswith('-clean'):
            replace(source, 'src/actions.h', 'void actionsSetLayer(uint8_t options);',
                    ('// Protocol caller validates the active image and target first.\n'
                     '// Bits 0-6 select the base layer; bit 7 services input timers (may consume).\n'
                     if optional else
                     '// Protocol caller validates the active image and absolute target first.\n'
                     '// Normal input timers run first and may consume this request.\n') +
                    'void actionsSetLayer(uint8_t options);')
            replace(source, 'src/actions.c', '  oneShotReturnLayer = 0xFF;\n  layerSelectionPending = 1;\n  updateLayer();\n}\n\nvoid actionsInit',
                    '  // A host selection replaces a pending one-shot; physical layer holds retain priority.\n'
                    '  oneShotReturnLayer = 0xFF;\n  layerSelectionPending = 1;\n  updateLayer();\n}\n\nvoid actionsInit')
        if candidate.endswith('-early'):
            path = source / 'src/protocol_firmware.c'
            text = path.read_text()
            start = text.index('    case PROTOCOL_SET_LAYER:')
            end = text.index('    case PROTOCOL_ENTER_BOOTLOADER:', start)
            case = text[start:end].replace('    case PROTOCOL_SET_LAYER:',
                    '  if (opcode == PROTOCOL_SET_LAYER) {\n      if (length) return PROTOCOL_BAD_RANGE;')
            case = case.replace('      break;\n', '      return PROTOCOL_OK;\n  }\n')
            text = text[:start] + text[end:]
            text = text.replace(' && opcode != PROTOCOL_SET_LAYER', '')
            insert = text.index('  if (opcode == PROTOCOL_READ_FLASH')
            path.write_text(text[:insert] + case + text[insert:])
    name = candidate
    patch = []
    for filename in FILES:
        patch.extend(difflib.unified_diff((ROOT / filename).read_text().splitlines(True),
                     (source / filename).read_text().splitlines(True),
                     fromfile='a/' + filename, tofile='b/' + filename))
    (HERE / (name + '.patch')).write_text(''.join(patch))
    hashes = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(source.rglob('*')) if p.is_file()
              and '__pycache__' not in p.parts and 'webUploader' not in p.parts}
    (HERE / ('source-' + name + '-sha256.json')).write_text(json.dumps(hashes, indent=2) + '\n')
    return source


def build(job):
    name, source, variant = job
    output = ARTIFACTS / name / ('three' if variant else 'six')
    command = [sys.executable, str(ROOT / 'pio-platform/build_firmware.py'), 'build',
               str(source), str(output), '24000000', '148', '14336', str(variant)]
    result = subprocess.run(command, capture_output=True, text=True)
    if not (output / 'firmware.mem').exists():
        raise RuntimeError(result.stdout[-2000:] + result.stderr[-2000:])
    mem = (output / 'firmware.mem').read_text()
    def size(label):
        return int(re.search(rf'{re.escape(label)}\s+0x\w+\s+0x\w+\s+(\d+)', mem)[1])
    row = dict(candidate=name, variant=variant, flash=size('ROM/EPROM/FLASH'),
               paged=size('PAGED EXT. RAM'), external=size('EXTERNAL RAM'),
               stack=int(re.search(r'with (\d+) bytes available', mem)[1]),
               code_limit=14336, returncode=result.returncode, artifacts=str(output))
    row['free'] = 14336 - row['flash']
    if result.returncode:
        print(result.stdout[-1500:] + result.stderr[-1500:], flush=True)
    else:
        row['firmware_sha256'] = hashlib.sha256((output / 'firmware.hex').read_bytes()).hexdigest()
    shutil.copyfile(output / 'firmware.mem', HERE / (name + '-' + str(variant) + '.mem'))
    print(json.dumps(row), flush=True)
    return row


def main():
    names = sys.argv[1:] or ['baseline', 'basic', 'initial-wake']
    sources = {name: prepare(name) for name in names}
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(build, [(name, source, variant)
                    for name, source in sources.items() for variant in (0, 1)]))
    destination = HERE / 'results.json'
    if destination.exists():
        rows = [r for r in json.loads(destination.read_text())['rows']
                if r['candidate'] not in names] + rows
    destination.write_text(json.dumps(dict(
        baseline_revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        baseline_status=subprocess.check_output(['git', 'status', '--short'], cwd=ROOT, text=True),
        rows=rows), indent=2) + '\n')


if __name__ == '__main__':
    main()
