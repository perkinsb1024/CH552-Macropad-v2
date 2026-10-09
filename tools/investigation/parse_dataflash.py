"""Decode a 128-byte DataFlash diagnostic dump (binary or whitespace-separated hex)."""
import argparse
import json
from pathlib import Path
import re
import sys

SIGNATURE = bytes.fromhex('D7 44 46 A6')
REASONS = {
    1: 'Invalid saved configuration at startup', 2: 'Unexpected invalid active state',
    3: 'Startup/explicit bootloader entry', 4: 'Runtime encoder hold',
    5: 'Invalid layer state', 6: 'Invalid action FIFO/input state',
    7: 'Invalid macro/action/encoder state', 8: 'Invalid USB/protocol state',
    9: 'Configuration save/readback failed', 10: 'Active configuration integrity failed',
    11: 'Invalid timer state',
}
SITES = {
    1: 'setup: invalid saved configuration', 2: 'firmwareApplyConfig: invalid active state',
    3: 'loop/scanEncoder: validity, integrity, or encoder state',
    4: 'setup: encoder held at startup', 5: 'loop: encoder held for 3000ms',
    6: 'enterBootloader: other explicit caller', 7: 'queueAction: action FIFO',
    8: 'actionsPoll/diagnosticCheckActions/resolvePending: runtime state',
    9: 'updateLayer: selected layer', 10: 'actionsPoll: macro cursor',
    11: 'protocolPoll: protocol/upload state', 12: 'USB queue/poll: report state',
    13: 'processRequest: configuration save', 14: 'timedEvent: timer state',
}
VALIDATION = {0: 'No validation failure', 1: 'Signature', 2: 'Version', 3: 'Variant',
              4: 'Layer layout', 5: 'Capacity/counts', 6: 'Action encoding',
              7: 'Chord encoding/order', 8: 'Timer encoding', 9: 'Text encoding',
              10: 'Macro encoding', 11: 'CRC'}


def crc16(data, excluded=()):
    crc = 0xFFFF
    for i, value in enumerate(data):
        if i in excluded:
            continue
        crc ^= value << 8
        for _ in range(8):
            crc = ((crc << 1) ^ (0x1021 if crc & 0x8000 else 0)) & 0xFFFF
    return crc


def read_dump(path):
    raw = Path(path).read_bytes()
    if len(raw) == 128:
        return raw
    try:
        text = raw.decode('ascii').strip()
    except UnicodeDecodeError as error:
        raise ValueError(f'Expected 128 binary bytes; received {len(raw)}') from error
    # Accept the configurator clipboard's contiguous hex and ordinary byte dumps.
    text = re.sub(r'0[xX]([0-9a-fA-F]{2})(?=\s|,|$)', r'\1', text)
    compact = re.sub(r'[\s,]', '', text)
    if not re.fullmatch(r'[0-9a-fA-F]{256}', compact):
        raise ValueError('Expected 128 binary bytes or exactly 256 hex digits; address columns are not supported')
    return bytes.fromhex(compact)


def decode(data):
    if len(data) != 128:
        raise ValueError(f'Expected 128 bytes; received {len(data)}')
    u16 = lambda offset: int.from_bytes(data[offset:offset + 2], 'little')
    features = data[7]
    crc_valid = crc16(data, (14, 15)) == u16(14)
    signature_valid = data[:4] == SIGNATURE
    verified = signature_valid and data[4] == 0xA5 and data[5] == 1 and data[6] in (0, 1) and crc_valid
    status = ('verified' if verified else 'not-diagnostic' if data[0] != 0xD7
              else 'unsupported-schema' if signature_valid and data[5] != 1
              else 'incomplete-or-corrupt')
    result = dict(status=status, trusted=verified, reservationPresent=data[0] == 0xD7,
                  signatureValid=signature_valid, complete=data[4] == 0xA5,
                  schema=data[5], crcValid=crc_valid, storedCrc=u16(14),
                  computedCrc=crc16(data, (14, 15)), rawHex=data.hex())
    if not signature_valid or data[5] != 1:
        return result
    # Even schema-1 fields are merely tentative if completion/CRC failed.
    result.update(buildId=u16(8), variant=data[6], keys=6 if data[6] == 0 else 3 if data[6] == 1 else None,
                  reasonCode=data[10], reason=REASONS.get(data[10], 'Unknown reason'),
                  siteId=data[11], site=SITES.get(data[11], 'Unknown site'), detail=u16(12),
                  features=dict(stackHighWater=bool(features & 1), macroRepeat=bool(features & 2),
                    scrollAcceleration=bool(features & 4), colorPreview=bool(features & 8),
                    activeCrc=bool(features & 16), savedCrc=bool(features & 32),
                    entrySnapshot=bool(features & 64), uptime=bool(features & 128)))
    uptime = int.from_bytes(data[16:20], 'little') if features & 128 else None
    result['uptimeMs'] = uptime
    result['cpu'] = (dict(sp=data[20], psw=data[21], ie=data[22], ip=data[23], pcon=data[24],
                         stackBase=data[25], stackHighWater=data[26] if features & 1 else None,
                         stackWindowCount=data[27], stackWindowHex=data[28:32].hex())
                     if features & 64 else None)
    flags = data[41]
    result['configuration'] = dict(headerHex=data[32:41].hex(), storedActiveCrc=u16(38),
        flashValid=bool(flags & 1), activeValid=bool(flags & 2), resetPending=bool(flags & 4),
        layerSelectionPending=bool(flags & 8), colorPreviewActive=bool(flags & 16),
        consumerReleasePending=bool(flags & 32), tempReady=bool(flags & 64),
        failureCategory=data[42], failure=VALIDATION.get(data[42], 'Unknown category'),
        offendingOffset=None if data[43] == 255 else data[43],
        computedActiveCrc=u16(44) if features & 16 else None,
        computedSavedCrc=u16(46) if features & 32 else None)
    result['inputs'] = dict(rawMask=data[48], stableMask=data[49], inputDown=data[50],
        p1=data[51], p3=data[52], encoderState=data[53],
        encoderMovement=data[54] if data[54] < 128 else data[54] - 256,
        allowRunBootloader=bool(data[55]), encoderPressedMs=u16(56),
        encoderRawChangedMs=u16(58), pendingInput=data[60], pendingLayer=data[61],
        pendingSinceMs=u16(62), elapsedEncoderHoldMs=(uptime - u16(56)) & 65535 if uptime is not None else None)
    action_names = ['baseLayer', 'effectiveLayer', 'previousLayer', 'oneShotReturnLayer',
                    'currentFirst', 'currentSecond', 'phase', 'macroNext', 'macroStart',
                    'macroRepeat', 'stringIndex']
    result['actions'] = dict(zip(action_names, data[64:75]))
    if not features & 2:
        result['actions']['macroRepeat'] = None
    result['actions'].update(deadlineMs=u16(75), tempFirst=data[77], tempSecond=data[78],
        tempOn=data[79], tempMouse=data[80], persistentMouse=data[81], eventHead=data[82],
        eventTail=data[83], eventUsed=data[84], droppedButtons=data[85],
        droppedRotation=data[86], consumerOwner=data[87],
        eventSlots=[list(data[i:i + 2]) for i in range(88, 104, 2)])
    result['usb'] = dict(config=data[104], endpointBusy=bool(data[105] & 1),
        configWaiting=bool(data[105] & 2), configTurn=bool(data[105] & 4),
        reportHead=data[106], reportTail=data[107], reportCount=data[108], reportGeneration=data[109])
    result['protocol'] = dict(state=data[110], uploadState=data[111])
    result['leds'] = dict(settings=list(data[112:116]), previewOptions=data[116],
        indicatorPhasesLeft=data[117], indicatorDeadline=data[118], rainbowHue=data[119])
    context = dict(rawHex=data[120:128].hex())
    if data[10] == 1:
        context.update(kind='saved-header', savedHeaderHex=data[120:128].hex())
    elif data[10] == 9:
        context.update(kind='save-failure', failedOffset=data[12], expected=data[13],
                       observed=data[120], stagedBytesHex=data[121:128].hex())
    elif data[10] == 11:
        context.update(kind='timer', index=data[120], clock=data[121], age=data[122],
                       high=data[123], fraction=data[124], pending=data[125], actionHex=data[126:128].hex())
    elif data[10] in (6, 7, 8):
        context.update(kind='action-trigger', currentActionHex=data[120:122].hex(),
                       rotation=None, input=None, tailSlotsHex=data[124:128].hex())
    else:
        context.update(kind='led', lastLayer=data[120], rainbowChanged=data[121],
                       firstTwoLedGrb=[list(data[122:125]), list(data[125:128])])
    result['context'] = context
    if flags & 128:
        result['reducedCapture'] = True
        result['rawInternalRam'] = dict(startAddress=0x50, endAddress=0x7B,
                                        hex=data[60:104].hex(), available=bool(features & 64))
        for key in ('pendingInput', 'pendingLayer', 'pendingSinceMs'):
            result['inputs'][key] = None
        result['actions'] = dict(eventSlots=[list(data[i:i + 2]) for i in range(112, 128, 2)])
        result['leds'] = None
        result['configuration'].update(failureCategory=None, failure='Not captured', offendingOffset=None,
                                      layerSelectionPending=None, tempReady=None, consumerReleasePending=None)
        result['context'] = dict(kind='raw-ram-and-action-fifo',
                                actionFifoHex=data[112:128].hex())
        if data[10] == 9:
            result['context'].update(failedOffset=data[12], expected=data[13], observed=data[43])
    else:
        result['reducedCapture'] = False
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dump', type=Path)
    parser.add_argument('--json', action='store_true', help='Emit structured JSON')
    parser.add_argument('--manifest', type=Path, help='Match the build ID and variant against retained artifacts')
    args = parser.parse_args()
    try:
        result = decode(read_dump(args.dump))
        if args.manifest:
            manifest = json.loads(args.manifest.read_text())
            if not isinstance(manifest, dict) or not isinstance(manifest.get('builds'), list):
                raise ValueError('Manifest must be an object with a builds array')
            matched = (manifest.get('buildId') == result.get('buildId') and
                       any(b['keys'] == result.get('keys') for b in manifest.get('builds', [])))
            result['manifestMatches'] = matched
            result['manifestNote'] = 'Build ID/variant match only; does not authenticate the flashed image.'
            if matched and result.get('reducedCapture') and result['rawInternalRam']['available']:
                build = next(b for b in manifest['builds'] if b['keys'] == result['keys'])
                memory = bytes.fromhex(result['rawInternalRam']['hex'])
                result['internalVariables'] = {}
                for name, address in build.get('internalSymbols', {}).items():
                    if 0x50 <= address <= 0x7B:
                        result['internalVariables'][name] = dict(address=address, byte=memory[address - 0x50])
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f'DataFlash record: {result["status"]}')
        if not result['trusted']:
            print('Record is not verified. Decoded fields, if present, are tentative; retain the raw dump.')
        if 'reason' in result:
            print(f'Build {result["buildId"]}, {result["keys"]}-key pad: {result["reason"]}')
            print(f'Site {result["siteId"]}: {result["site"]}; detail 0x{result["detail"]:04X}')
        print(json.dumps(result, indent=2))
    return 0 if result['trusted'] and result.get('manifestMatches', True) else 2


if __name__ == '__main__':
    sys.exit(main())
