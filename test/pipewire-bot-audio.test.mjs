import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { parseBotAudioPipewire, validatePipewireEnv } from '../lib/bot-audio.mjs';
import { openMic } from '../lib/mic.mjs';
import { enterRoom } from '../lib/session.mjs';

const config = { remote: '/tmp/potalk-pipewire-test', serial: '42' };
const env = { POTALK_BOT_PW_REMOTE: config.remote, POTALK_BOT_PW_SERIAL: config.serial };

function child() {
  const p = new EventEmitter();
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();
  p.kill = () => {};
  return p;
}

function sessionRoom() {
  return {
    roomId: 'offline-pipewire-room', bcast: false, canTalk: true, micMuted: true,
    meta: () => ({ name: 'offline' }), members: () => [], growthStage: () => '',
    setMicMuted(value) { this.micMuted = value; }, async leave() {}
  };
}

test('PipeWire flag validates env, ignores env without flag, and rejects malformed/equal forms', () => {
  assert.deepEqual(parseBotAudioPipewire(['--bot-audio-pipewire'], { env }), config);
  assert.equal(parseBotAudioPipewire([], { env: { POTALK_BOT_PW_REMOTE: '\0bad', POTALK_BOT_PW_SERIAL: 'nope' } }), null);
  assert.deepEqual(validatePipewireEnv(env), config);
  assert.throws(() => parseBotAudioPipewire(['--bot-audio-pipewire'], { env: { ...env, POTALK_BOT_PW_SERIAL: '0' } }), TypeError);
  assert.throws(() => parseBotAudioPipewire(['--bot-audio-pipewire=x'], { env }), TypeError);
});

test('openMic normalizes PipeWire config, pins serial, enables capture.sink, and sets remote', () => {
  const calls = [];
  const p = child();
  const mic = openMic({ pipewire: config, pulseSource: 'BotSink_test.monitor', spawnImpl: (...args) => {
    calls.push(args);
    return p;
  } });
  mic.start();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'pw-cat');
  assert.deepEqual(calls[0][1].slice(0, 4), ['--record', '--target', '42', '--rate']);
  assert.match(calls[0][1].join(' '), /stream\.capture\.sink=true/);
  assert.equal(calls[0][2].env.PIPEWIRE_REMOTE, config.remote);
  mic.stop();
});

test('PipeWire recorder missing or exiting reports once and never starts a fallback', () => {
  for (const event of ['error', 'exit']) {
    const errors = [], calls = [], p = child();
    const mic = openMic({ pipewire: config, pulseSource: 'BotSink_test.monitor', onError: e => errors.push(e), spawnImpl: (...args) => { calls.push(args[0]); return p; } });
    mic.start();
    if (event === 'error') p.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    else p.emit('exit', 1);
    p.emit('exit', 1);
    assert.equal(errors.length, 1);
    assert.deepEqual(calls, ['pw-cat']);
    assert.equal(mic.running, false);
  }
});

test('session native failure calls onFatal, mutes, does not restart, and stale old exit is ignored', async () => {
  const children = [], calls = [], fatals = [], messages = [];
  const room = sessionRoom();
  const session = enterRoom({
    target: { roomId: room.roomId, name: 'offline' }, profile: { name: 'test', emoji: '' }, lobby: {}, sound: false,
    pulseSource: 'BotSink_test.monitor', pipewire: config, onText: text => messages.push(text), onFatal: error => fatals.push(error),
    openRoomImpl: () => room,
    openMicImpl: options => openMic({ ...options, spawnImpl: (...args) => { calls.push(args[0]); const p = child(); children.push(p); return p; } })
  });
  session.setTalk(true);
  assert.equal(children.length, 1);
  children[0].emit('error', Object.assign(new Error('missing pw-cat'), { code: 'ENOENT' }));
  assert.equal(room.micMuted, true);
  assert.equal(fatals.length, 1);
  session.setTalk(true);
  assert.equal(children.length, 1);
  assert.equal(room.micMuted, true);
  children[0].emit('exit', 1);
  assert.equal(fatals.length, 1);
  await session.leave();
  assert.deepEqual(calls, ['pw-cat']);
  assert.ok(messages.some(text => text.includes('pw-cat')));
});

test('explicit stop/start ignores an old recorder exit without disturbing the new recorder', () => {
  const children = [], errors = [];
  const mic = openMic({ pipewire: config, pulseSource: 'BotSink_test.monitor', onError: e => errors.push(e),
    spawnImpl: () => { const p = child(); children.push(p); return p; } });
  mic.start(); mic.stop(); mic.start();
  children[0].emit('exit', 1);
  assert.equal(mic.running, true);
  assert.deepEqual(errors, []);
  mic.stop();
});
