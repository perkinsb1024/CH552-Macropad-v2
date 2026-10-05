import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** Compile the actual firmware parser once, so codec tests have an independent oracle. */
export function createFirmwareValidator() {
  const directory = mkdtempSync(join(tmpdir(), 'macropad-v8-codec-'));
  const binary = join(directory, 'validate');
  const source = join(directory, 'validate.c');
  const firmware = fileURLToPath(new URL('../../src/', import.meta.url));
  writeFileSync(source, '#include <stdio.h>\n#include <stdlib.h>\n#include "config.h"\nint main(int argc,char **argv){if(argc!=2 || fread(activeConfig,1,128,stdin)!=128)return 3;return configValid(activeConfig,atoi(argv[1]))?0:2;}\n');
  const result = spawnSync('cc', ['-std=c99', '-D__xdata=', '-D__data=', '-D__code=', '-I' + firmware, source, join(firmware, 'config.c'), '-o', binary]);
  if (result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(result.stderr?.toString() || 'Could not compile firmware validator');
  }
  return {
    accepts(image, variant) {
      const result = spawnSync(binary, [String(variant)], { input: image });
      if (result.status !== 0 && result.status !== 2) throw new Error(result.stderr?.toString() || 'Firmware validator failed');
      return result.status === 0;
    },
    close() { rmSync(directory, { recursive: true, force: true }); },
  };
}
