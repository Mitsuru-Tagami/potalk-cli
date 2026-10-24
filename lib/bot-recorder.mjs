import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBotAudioSource } from './bot-audio.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binaryPath = resolve(root, 'native/build/pulse-no-move.so');
const metadataPath = resolve(root, 'native/build/pulse-no-move.json');
const sha256 = data => createHash('sha256').update(data).digest('hex');

function verifyBuild() {
  let metadata;
  let sourceBytes;
  let binaryBytes;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    sourceBytes = readFileSync(resolve(root, 'native/pulse-no-move.c'));
    binaryBytes = readFileSync(binaryPath);
    statSync(binaryPath);
  } catch {
    throw new Error('bot audio native helper is not built; run npm run build:bot-audio');
  }
  if (metadata.sourceSha256 !== sha256(sourceBytes) || metadata.binarySha256 !== sha256(binaryBytes)) {
    throw new Error('bot audio native helper integrity check failed; run npm run build:bot-audio');
  }
}

function probeServer() {
  const info = execFileSync('pactl', ['info'], {
    env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', timeout: 2000, maxBuffer: 65536,
  });
  return /^Server Name: (.+)$/m.exec(info)?.[1]?.trim();
}

/**
 * Prepare a bot-only ALSA rec recorder. The parent environment is never modified.
 * The caller must not consume PCM until the helper's fd 3 readiness marker is received.
 */
export function prepareBotRecorder(source, { probeServerImpl = probeServer } = {}) {
  if (process.platform !== 'linux') throw new Error('bot audio recorder is supported on Linux only');
  validateBotAudioSource(source);
  // ld.so separates LD_PRELOAD entries at spaces and colons; do not accept a
  // path which could silently load a different library (or none at all).
  if (/[\s:]/.test(binaryPath)) throw new Error('bot audio CLI path must not contain whitespace or colons');
  verifyBuild();
  if (probeServerImpl() !== 'pulseaudio') {
    throw new Error('BOT録音は検証済みPulseAudioのみ対応です。PipeWireまたは不明なサーバーでは録音しません');
  }

  const directory = mkdtempSync(resolve(tmpdir(), 'potalk-bot-audio-'));
  const alsaConfig = resolve(directory, 'asound.conf');
  writeFileSync(alsaConfig, `pcm.pulse {\n  type pulse\n  device "${source}"\n}\n`, { mode: 0o600 });
  let cleaned = false;
  return {
    command: 'rec',
    args: ['-q', '-t', 'raw', '-r', '48000', '-e', 'signed-integer', '-b', '16', '-c', '1', '-'],
    options: {
      env: {
        ...process.env,
        AUDIODRIVER: 'alsa',
        AUDIODEV: 'pulse',
        PULSE_SOURCE: source,
        ALSA_CONFIG_PATH: alsaConfig,
        LD_PRELOAD: binaryPath,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
