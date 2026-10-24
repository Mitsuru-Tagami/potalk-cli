// 専用の物理デバイスなしPulseAudioサーバーでのみ実行する。
// node scripts/offline-audio-check.mjs がサーバーを生成し、環境変数を設定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { openMic } from '../lib/mic.mjs';

const enabled = process.env.PTK_ISOLATED_AUDIO_TEST === '1';
const source = 'BotSink_realtest.monitor';
const pactl = (...args) => execFileSync('pactl', args, { encoding: 'utf8', timeout: 5000 });
const list = name => JSON.parse(pactl('-f', 'json', 'list', name));
async function until(predicate, label, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = predicate(); if (result) return result; await delay(30); }
  throw new Error('timeout: ' + label);
}
function tone(sink, frequency) {
  const pcm = Buffer.alloc(48000 * 2 * 12);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * frequency * i / 48000)), i * 2);
  const child = spawn('pacat', ['--playback', '--raw', '--rate=48000', '--channels=1', '--format=s16le', '--device=' + sink], { stdio: ['pipe', 'ignore', 'pipe'] });
  child.stdin.on('error', () => {}); child.stdin.end(pcm);
  return child;
}
function power(samples, hz) {
  let re = 0, im = 0;
  for (let i = 0; i < samples.length; i++) {
    re += samples[i] * Math.cos(2 * Math.PI * hz * i / 48000);
    im += samples[i] * Math.sin(2 * Math.PI * hz * i / 48000);
  }
  return (re * re + im * im) / samples.length ** 2;
}

test('実ALSA pulse: 異なる既定sourceがあっても専用monitorの音だけを取得し、移動と消失時fallbackを禁止する', { skip: !enabled, timeout: 20000 }, async () => {
  const version = execFileSync('sox', ['--help'], { encoding: 'utf8' });
  assert.match(version, /AUDIO DEVICE DRIVERS: alsa\s*\n/);
  const originalDefault = pactl('get-default-source').trim();
  assert.equal(originalDefault, 'DefaultDecoy.monitor');
  const moduleId = pactl('load-module', 'module-null-sink', 'sink_name=BotSink_realtest', 'rate=48000').trim();
  const players = [tone('DefaultDecoy', 880), tone('BotSink_realtest', 440)];
  const errors = [], procs = [], captured = [];
  const mic = openMic({ pulseSource: source, onError: e => errors.push(e), spawnImpl(...args) {
    const proc = spawn(...args); procs.push(proc); return proc;
  } });
  let timer;
  try {
    assert.equal(mic.start(), true);
    const output = await until(() => list('source-outputs').find(x => x.properties?.['application.process.id'] === String(procs[0].pid)), 'ALSA stream');
    const actualSource = list('sources').find(x => x.index === output.source);
    assert.equal(actualSource.name, source);
    timer = setInterval(() => { const block = mic.take(480); if (block) captured.push(...block); }, 10);
    await until(() => captured.length >= 24000, 'PCM capture');
    clearInterval(timer);
    const p440 = power(captured, 440), p880 = power(captured, 880);
    assert.ok(p440 > 100000, '440Hz source must be audible');
    assert.ok(p440 > p880 * 100, 'default 880Hz must not be captured');
    // DONT_MOVEは手動の移動要求もサーバーで拒否される。
    assert.throws(() => pactl('move-source-output', String(output.index), 'DefaultDecoy.monitor'));
    assert.equal(list('source-outputs').find(x => x.index === output.index).source, actualSource.index);
    pactl('unload-module', moduleId);
    await until(() => errors.length > 0, 'source removal must stop recorder');
    assert.equal(mic.running, false); assert.equal(mic.take(480), null);
    assert.equal(procs.length, 1, 'no automatic retry or default-mic fallback');
    assert.equal(list('source-outputs').some(x => x.properties?.['application.process.id'] === String(procs[0].pid)), false);
    assert.equal(pactl('get-default-source').trim(), originalDefault);
    console.log(JSON.stringify({ actualSource: actualSource.name, defaultSource: originalDefault,
      sampleCount: captured.length, power440: p440, power880: p880, moveDenied: true,
      monitorRemovalStopped: true, errors }, null, 2));
  } finally {
    clearInterval(timer); mic.stop(); for (const child of players) child.kill();
    try { pactl('unload-module', moduleId); } catch {}
  }
});

test('実ALSA pulse: 存在しないmonitorは既定sourceを開かず終了する', { skip: !enabled, timeout: 10000 }, async () => {
  const errors = [], procs = [];
  const mic = openMic({ pulseSource: 'BotSink_missing.monitor', onError: e => errors.push(e), spawnImpl(...args) {
    const proc = spawn(...args); procs.push(proc); return proc;
  } });
  try {
    mic.start(); await until(() => errors.length, 'missing source failure');
    assert.equal(mic.running, false); assert.equal(mic.take(480), null); assert.equal(procs.length, 1);
    assert.equal(list('source-outputs').some(x => x.properties?.['application.process.id'] === String(procs[0].pid)), false);
    console.log(JSON.stringify({ missingSourceClosed: true, errors }));
  } finally { mic.stop(); }
});
