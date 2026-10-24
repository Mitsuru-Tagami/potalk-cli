import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'native/pulse-no-move.c');
const buildDir = resolve(root, 'native/build');
const binary = resolve(buildDir, 'pulse-no-move.so');
const metadata = resolve(buildDir, 'pulse-no-move.json');

mkdirSync(buildDir, { recursive: true });
const sha256 = data => createHash('sha256').update(data).digest('hex');
const temporary = mkdtempSync(resolve(buildDir, 'compile-'));
try {
  const compiled = resolve(temporary, 'pulse-no-move.so');
  const result = spawnSync('cc', [
    '-shared', '-fPIC', '-O2', '-Wall', '-Wextra', '-Werror',
    source, '-o', compiled, '-ldl',
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('native build failed: ' + result.status);
  const manifest = resolve(temporary, 'pulse-no-move.json');
  writeFileSync(manifest, `${JSON.stringify({
    sourceSha256: sha256(readFileSync(source)),
    binarySha256: sha256(readFileSync(compiled)),
  }, null, 2)}\n`);
  renameSync(compiled, binary);
  renameSync(manifest, metadata);
  console.log(`built ${binary}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
