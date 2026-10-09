"""Check target allocation and replay the linked parameter store/read fragments.

This is not a whole-device emulator or a hardware reproduction of either fault.
"""
import argparse
import json
from pathlib import Path
import re

from build_firmware import symbols, measure


def load_hex(path):
    rom = bytearray(14336)
    for line in path.read_text().splitlines():
        data = bytes.fromhex(line[1:])
        assert sum(data) & 255 == 0
        if data[3] == 0:
            address = int.from_bytes(data[1:3], 'big')
            assert address + data[0] <= len(rom)
            rom[address:address + data[0]] = data[4:4 + data[0]]
        else:
            assert data[3] == 1
    return rom


def instructions(path, rom):
    rows = []
    pattern = r'^\s*([0-9A-F]{6}) ((?:[0-9A-F]{2} )+)\s*\[\d+\]\s+\d+\s+(.*)$'
    for line in path.read_text().splitlines():
        match = re.match(pattern, line)
        if match:
            pc = int(match[1], 16)
            code = bytes.fromhex(match[2])
            assert rom[pc:pc + len(code)] == code, f'Listing/HEX mismatch at {pc:x}'
            rows.append((pc, code, match[3]))
    return rows


def verify(build, baseline, fixed):
    names, base = symbols(build), symbols(baseline)
    rom = load_hex(build / 'firmware.hex')
    assert names['__start__stack'] <= base['__start__stack'], 'Stack capacity reduced'
    assert names['_activeConfig'] == 0x300
    assert rom[names['_main']] == 0x12, 'Unexpected main prefix; stack fill must be disabled'
    assert names['l_XSEG'] + names['s_XSEG'] <= 0x300
    params = ['_USB_setIdle_PARM_2', '_USB_getReport_PARM_2', '_USB_getReport_PARM_3']
    asm = (build / 'hid_USBHIDKeyboardMouse.asm').read_text()
    if fixed:
        # These are the modules containing the USB ISR and its application
        # helpers. Reject any remaining overlaid parameter/local allocation.
        for module in ('hid_USBHIDKeyboardMouse', 'hid_USBhandler', 'protocol_firmware'):
            section = ''
            for line in (build / (module + '.asm')).read_text().splitlines():
                if '.area' in line:
                    section = line
                assert not ('OSEG' in section and re.match(r'^\w+:', line)), (module, line)
    for param in params:
        section = asm[:asm.index(param + ':')].rsplit('.area', 1)[-1]
        assert ('XSEG' if fixed else 'OSEG') in section, (param, section)
        if fixed:
            assert names['s_XSEG'] <= names[param] < names['s_XSEG'] + names['l_XSEG']
        else:
            assert names['s_OSEG'] <= names[param] < names['s_OSEG'] + names['l_OSEG']

    foreground = (build / 'actions.rst').read_text()
    queue = int(re.search(r'(?m)^\s*([0-9A-F]{6})\s+\d+ _queueAction_PARM_2:', foreground)[1], 16)
    handler = instructions(build / 'hid_USBhandler.rst', rom)
    action = instructions(build / 'actions.rst', rom)
    read = next(code for _, code, text in action if text == 'mov\ta,_queueAction_PARM_2')
    assert read == bytes([0xe5, queue])
    if fixed:
        pointer = next(i for i, (_, _, text) in enumerate(handler)
                       if text == 'mov\tdptr,#_USB_setIdle_PARM_2')
        # Locate the actual MOVX store following this parameter address load.
        fragment = handler[pointer:pointer + 5]
        assert fragment[0][1] == bytes([0x90, names[params[0]] >> 8, names[params[0]] & 255])
        store = next(code for _, code, text in fragment if text == 'movx\t@dptr,a')
        assert store == b'\xf0'
    else:
        store = next(code for _, code, text in handler if text == 'mov\t_USB_setIdle_PARM_2,a')
        assert store == bytes([0xf5, names[params[0]]])
        assert queue == names[params[0]]

    # Replay those actual instructions with all possible foreground argument
    # values and idle rates. Registers/DPTR are treated as saved by the wrapper;
    # this specifically tests the shared-memory store across preemption.
    for argument in range(256):
        for rate in range(256):
            ram, xram = bytearray(256), bytearray(1024)
            ram[queue] = argument
            if store[0] == 0xf5:
                ram[store[1]] = rate
            else:
                xram[names[params[0]]] = rate
            resumed = ram[read[1]]
            assert resumed == (argument if fixed else rate)

    # Replay all three actual GET_REPORT parameter stores, including its
    # two-byte output pointer. Verify which memory space they touch.
    if fixed:
        first = next(i for i, (_, _, text) in enumerate(handler)
                     if text == 'mov\tdptr,#_USB_getReport_PARM_2')
        last = next(i for i in range(first, len(handler)) if handler[i][2] == 'lcall\t_USB_getReport')
        report_fragment = [code for _, code, _ in handler[first:last]
                           if code[0] in (0x90, 0x74, 0xa3, 0xf0)]
    else:
        report_fragment = [code for _, code, text in handler if text.startswith((
            'mov\t_USB_getReport_PARM_2,', 'mov\t_USB_getReport_PARM_3,',
            'mov\t(_USB_getReport_PARM_3 + 1),'))]
    assert sum(code[0] in (0xf0, 0xf5, 0x75) for code in report_fragment) == 3
    for output in (0, 1):
        ram, xram = bytearray([56] * 256), bytearray(1024)
        before = ram[:]
        accumulator, dptr = output, 0
        for code in report_fragment:
            if code[0] == 0x90:
                dptr = int.from_bytes(code[1:], 'big')
            elif code[0] == 0x74:
                accumulator = code[1]
            elif code[0] == 0xa3:
                dptr += 1
            elif code[0] == 0xf0:
                xram[dptr] = accumulator
            elif code[0] == 0xf5:
                ram[code[1]] = accumulator
            elif code[0] == 0x75:
                ram[code[1]] = code[2]
            else:
                raise AssertionError(code.hex())
        memory = xram if fixed else ram
        assert memory[names[params[1]]] == output
        pointer = names[params[2]]
        assert memory[pointer] | (memory[pointer + 1] << 8) == names['_Ep0Report']
        if fixed:
            assert ram == before, 'GET_REPORT parameter setup changed internal RAM'
        else:
            assert ram[queue] == output
    return dict(fixed=fixed, replayCases=65536, getReportCases=2, exampleArgument=56,
                exampleIdleRate=0, resumedArgument=56 if fixed else 0,
                parameterAddresses={p: names[p] for p in params}, **measure(build))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('build', type=Path)
    parser.add_argument('--baseline', required=True, type=Path)
    kind = parser.add_mutually_exclusive_group(required=True)
    kind.add_argument('--fixed', action='store_true')
    kind.add_argument('--overlap', action='store_true')
    args = parser.parse_args()
    result = verify(args.build, args.baseline, args.fixed)
    (args.build / 'linked-verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
