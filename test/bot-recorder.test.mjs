import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBotRecorder as realPrepareBotRecorder } from '../lib/bot-recorder.mjs';

const prepareBotRecorder = source => realPrepareBotRecorder(source, { probeServerImpl: () => 'pulseaudio' });

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const build = () => {
  const result = spawnSync('npm', ['run', 'build:bot-audio'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};

before(() => {
  if (process.platform === 'linux') build();
});

test('build produces the native helper and metadata', { skip: process.platform !== 'linux' }, () => {
  assert.ok(existsSync(resolve(root, 'native/build/pulse-no-move.so')));
  const metadata = JSON.parse(readFileSync(resolve(root, 'native/build/pulse-no-move.json'), 'utf8'));
  assert.match(metadata.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(metadata.binarySha256, /^[a-f0-9]{64}$/);
});

test('prepareBotRecorder returns exact recorder command and isolated child env', { skip: process.platform !== 'linux' }, () => {
  const oldPreload = process.env.LD_PRELOAD;
  process.env.LD_PRELOAD = '/parent/preload.so';
  const recorder = prepareBotRecorder('BotSink_test123.monitor');
  try {
    assert.deepEqual(recorder.command, 'rec');
    assert.deepEqual(recorder.args, ['-q', '-t', 'raw', '-r', '48000', '-e', 'signed-integer', '-b', '16', '-c', '1', '-']);
    assert.equal(recorder.options.stdio.join(','), 'ignore,pipe,pipe,pipe');
    assert.equal(recorder.options.env.AUDIODRIVER, 'alsa');
    assert.equal(recorder.options.env.AUDIODEV, 'pulse');
    assert.equal(recorder.options.env.PULSE_SOURCE, 'BotSink_test123.monitor');
    assert.equal(recorder.options.env.LD_PRELOAD, resolve(root, 'native/build/pulse-no-move.so'));
    assert.notEqual(recorder.options.env.LD_PRELOAD, oldPreload);
    assert.match(readFileSync(recorder.options.env.ALSA_CONFIG_PATH, 'utf8'), /type pulse/);
    assert.match(readFileSync(recorder.options.env.ALSA_CONFIG_PATH, 'utf8'), /device "BotSink_test123\.monitor"/);
    assert.equal(process.env.LD_PRELOAD, '/parent/preload.so');
    recorder.cleanup();
    recorder.cleanup();
    assert.equal(existsSync(recorder.options.env.ALSA_CONFIG_PATH), false);
  } finally {
    if (oldPreload === undefined) delete process.env.LD_PRELOAD;
    else process.env.LD_PRELOAD = oldPreload;
  }
});

test('tampered or missing helper is rejected with build instruction', { skip: process.platform !== 'linux' }, () => {
  const metadataPath = resolve(root, 'native/build/pulse-no-move.json');
  const original = readFileSync(metadataPath, 'utf8');
  try {
    const tampered = JSON.parse(original);
    tampered.binarySha256 = '0'.repeat(64);
    writeFileSync(metadataPath, JSON.stringify(tampered));
    assert.throws(() => prepareBotRecorder('BotSink_test123.monitor'), /integrity check failed/);
    writeFileSync(metadataPath, original);
    const binaryPath = resolve(root, 'native/build/pulse-no-move.so');
    const binary = readFileSync(binaryPath);
    writeFileSync(binaryPath, Buffer.concat([binary, Buffer.from([0])]));
    assert.throws(() => prepareBotRecorder('BotSink_test123.monitor'), /integrity check failed/);
    writeFileSync(binaryPath, binary);
    writeFileSync(binaryPath, Buffer.alloc(0));
    assert.throws(() => prepareBotRecorder('BotSink_test123.monitor'), /integrity check failed/);
    writeFileSync(binaryPath, binary);
  } finally {
    writeFileSync(metadataPath, original);
    build();
  }
});

test('invalid source and non-Linux support contract are rejected', { skip: process.platform !== 'linux' }, () => {
  assert.throws(() => prepareBotRecorder('Default.monitor'), /bot audio source/);
});

test('未検証PipeWire・不明なサーバー・照会失敗では録音前に拒否する', { skip: process.platform !== 'linux' }, () => {
  for (const name of ['PulseAudio (on PipeWire 1.0.5)', 'unknown', undefined]) {
    assert.throws(() => realPrepareBotRecorder('BotSink_test123.monitor', { probeServerImpl: () => name }), /録音しません/);
  }
  assert.throws(() => realPrepareBotRecorder('BotSink_test123.monitor', { probeServerImpl() { throw new Error('probe failed'); } }), /probe failed/);
});
