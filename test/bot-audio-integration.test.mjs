import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { parseBotAudioSource, enableBotAudio } from '../lib/bot-audio.mjs';
import { findRoomArgument } from '../lib/cli-args.mjs';
import { openMic } from '../lib/mic.mjs';
import { enterRoom } from '../lib/session.mjs';
import { runJoin } from '../commands/join.mjs';

const source = 'BotSink_offline123.monitor';

function makeSession() {
  const calls = [], children = [], messages = [];
  const room = {
    roomId: 'offline-only-room', bcast: false, canTalk: true, micMuted: true,
    meta: () => ({ name: 'offline test' }),
    setMicMuted(value) { this.micMuted = value; },
    async leave() {}
  };
  const session = enterRoom({
    target: { roomId: room.roomId, name: 'offline test' },
    profile: { name: 'test', emoji: '' }, lobby: {}, sound: false,
    pulseSource: source, onText: text => messages.push(text),
    openRoomImpl: () => room,
    createTtsImpl: () => ({ speak() {}, close() {} }),
    openMicImpl: options => {
      assert.equal(options.pulseSource, source);
      return openMic({ ...options, spawnImpl(command, args) {
        calls.push({ command, args });
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => {};
        children.push(child);
        return child;
      } });
    }
  });
  return { session, room, calls, children, messages };
}

test('BOT入力オプションは部屋名の前後どちらでも値を部屋名と誤認しない', () => {
  for (const args of [
    ['--bot-audio-source', source, 'test-room'],
    ['test-room', '--bot-audio-source', source],
    ['--no-sound', '--bot-audio-source', source, '--name', 'BOT', 'test-room'],
  ]) {
    assert.equal(parseBotAudioSource(args, { command: 'join' }), source);
    assert.equal(findRoomArgument(args), 'test-room');
  }
  assert.equal(findRoomArgument(['--bot-audio-source', source]), undefined);
  for (const command of ['lobby', 'list', '--help']) {
    assert.throws(() => parseBotAudioSource(['--bot-audio-source', source], { command }), TypeError);
  }
});

test('明示オン→既にオン→手動オフ/オンも同じ専用monitorを使う', async () => {
  const state = makeSession();
  try {
    assert.equal(state.calls.length, 0);
    enableBotAudio(state.session, source);
    assert.equal(state.session.micOn, true);
    enableBotAudio(state.session, source);
    assert.equal(state.session.micOn, true);
    assert.equal(state.calls.length, 1);
    state.session.command('/mic');
    assert.equal(state.session.micOn, false);
    state.session.command('/mic');
    assert.equal(state.session.micOn, true);
    assert.equal(state.calls.length, 2);
    for (const call of state.calls) {
      assert.equal(call.command, 'sox');
      assert.deepEqual(call.args.slice(0, 3), ['-t', 'pulseaudio', source]);
    }
  } finally { await state.session.leave(); }
});

test('BOT録音の起動エラーでミュートし、物理マイクへfallbackしない', async () => {
  const state = makeSession();
  try {
    enableBotAudio(state.session, source);
    state.children[0].emit('error', Object.assign(new Error('mock missing sox'), { code: 'ENOENT' }));
    assert.equal(state.session.micOn, false);
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].command, 'sox');
    assert.ok(state.messages.some(text => text.includes('sox')));
  } finally { await state.session.leave(); }
});

test('BOT録音の終了エラーでミュートし、再試行・rec fallbackを行わない', async () => {
  const state = makeSession();
  try {
    enableBotAudio(state.session, source);
    state.children[0].stderr.write('mock pulse source unavailable');
    state.children[0].emit('exit', 1);
    assert.equal(state.session.micOn, false);
    assert.equal(state.calls.length, 1);
    assert.ok(state.messages.some(text => text.includes('mock pulse source unavailable')));
  } finally { await state.session.leave(); }
});

test('runJoinは専用sourceを渡し、標準入力受付より先に一度だけ明示オンにする', async () => {
  const listeners = new Map(['uncaughtException', 'SIGINT', 'SIGHUP', 'SIGTERM'].map(name => [name, new Set(process.listeners(name))]));
  const oldWarn = console.warn;
  const order = [];
  const rl = { on(name) { order.push(`listen:${name}`); }, closed: false };
  try {
    await runJoin({
      create: 'offline test', profile: { name: 'test', emoji: '' },
      sound: false, pulseSource: source,
      createReadlineImpl: () => rl,
      openLobbyImpl: () => ({ async leave() {} }),
      enterRoomImpl(options) {
        assert.equal(options.pulseSource, source);
        order.push('session');
        return { room: { canTalk: true }, setTalk(on) { order.push(`talk:${on}`); } };
      }
    });
    assert.equal(order.filter(step => step === 'talk:true').length, 1);
    assert.ok(order.indexOf('session') < order.indexOf('talk:true'));
    assert.ok(order.indexOf('talk:true') < order.indexOf('listen:line'));
  } finally {
    console.warn = oldWarn;
    for (const [name, before] of listeners) {
      for (const listener of process.listeners(name)) if (!before.has(listener)) process.removeListener(name, listener);
    }
  }
});
