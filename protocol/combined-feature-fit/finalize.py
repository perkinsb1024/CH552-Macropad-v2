"""Prepare the selected source and measure the exact integration candidate."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('measure', HERE / 'measure.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

name = sys.argv[1] if len(sys.argv) > 1 else 'selected'
source = m.blank(name)
m.combined(source)
m.optimize('order-m', source)
m.replace(source, 'src/config.h',
    '// Format 18 adds a fifth timer and uses chord scope 7 for globals.',
    '// Format 18 adds a fifth timer, scope-7 global chords and tap-hold records.')
m.replace(source, 'src/config.h',
    '// Action numbers are part of the saved format; v18 retains the finalized v16 map.',
    '// Action numbers are part of the saved format; v18 extends the v16 map with F.')
m.replace(source, 'src/config.h', '#define CONFIG_ACTION_RESERVED         0xF\n', '')
m.replace(source, 'src/config.c',
    '// Each product fits a byte after the layer/chord count checks; the sum\n'
    '    // remains 16-bit so malformed images cannot wrap past the capacity check.',
    '// Products fit a byte after the layer/chord count checks. Check section\n'
    '    // capacity before adding the bounded pool/palette subtotal below.')
for p in (source / 'tests').glob('*.[ch]'):
    p.write_text(p.read_text().replace('CONFIG_ACTION_RESERVED', 'CONFIG_ACTION_TAP_HOLD'))
m.replace(source, 'CH552_Universal_Macropad.ino',
    '// Raw levels use ordinary external RAM to preserve the internal stack reserve.\n'
    '// Stable levels and debounce times remain private to this main-loop scanner.',
    '// Hot raw levels use page-zero RAM; debounce times use ordinary external RAM.\n'
    '// Stable levels remain internal and private to this main-loop scanner.')
m.replace(source, 'src/actions.c',
    '__xdata uint16_t tapSince[PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 4 : 7];',
    '// Independent clocks start at accepted press, or chord recognition for a chord.\n'
    '__xdata uint16_t tapSince[PHYSICAL_VARIANT == CONFIG_THREE_KEYS ? 4 : 7];')
m.replace(source, 'src/actions.c',
    '  return elapsed > (((uint16_t)buttonFirst[input] << 1) | 1);',
    '  // F = 16 * selector + 15, so (2 * first | 1) is threshold minus one.\n'
    '  // Widen before doubling; selector 15 requires a 512ms threshold.\n'
    '  return elapsed > (((uint16_t)buttonFirst[input] << 1) | 1);')
m.replace(source, 'src/actions.c', 'static ACTION_BIT inputPolling;',
    '// Ordinary chord deadlines retain their post-scan order. The pre-scan pass\n'
    '// resolves tap-hold decisions; the poll marks itself and the helper clears it.\n'
    'static ACTION_BIT inputPolling;')
m.replace(source, 'tests/run_host_tests.py',
    'flags += ["-D" + arg.removeprefix("--define=")',
    'flags.append("-DTAP_HOLD_COMBINED=1")\n'
    'flags += ["-D" + arg.removeprefix("--define=")')
import shutil
shutil.copyfile(HERE / 'chord_scan_order_test.c', source / 'tests/chord_scan_order_test.c')
m.replace(source, 'tests/run_host_tests.py', '    for suite in suites:',
    '    suites += [("chord_scan_order", ["src/config.c", "src/actions.c"], variant) for variant in (0, 1)]\n'
    '    for suite in suites:')
p = source / 'tests/tap_hold_test.c'
s = p.read_text()
extra = (HERE / 'elapsed_test.c').read_text()
s = s.replace('int main(void) {', extra + '\nint main(void) {\n    testElapsedRange();')
p.write_text(s)
p = source / 'tests/tap_hold_integration_test.c'
s = p.read_text()
extra = (HERE / 'chord_hold_scan_test.c').read_text()
s = s.replace('int main(void) {', extra + '\nint main(void) {\n    testChordHoldScan();')
p.write_text(s)
m.save(name, source)
with ThreadPoolExecutor(max_workers=2) as pool:
    rows = list(pool.map(m.prior.build, [(name, source, v) for v in (0, 1)]))
dest = HERE / 'results.json'
data = json.loads(dest.read_text())
data['rows'] = [r for r in data['rows'] if r['candidate'] != name] + rows
dest.write_text(json.dumps(data, indent=2) + '\n')
if any(r['real_limit_returncode'] or r['layout_checks'] != 'passed' for r in rows):
    sys.exit(1)
