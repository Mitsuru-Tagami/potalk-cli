import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BOT_AUDIO_CONTRACT,
  enableBotAudio,
  isBotAudioSource,
  parseBotAudioSource,
  validateBotAudioSource,
} from '../lib/bot-audio.mjs';

const modulePath = fileURLToPath(new URL('../lib/bot-audio.mjs', import.meta.url));

test('BOT音声ソースは専用sink monitor名だけを受け付ける', () => {
  assert.equal(validateBotAudioSource('BotSink_alpha9.monitor'), 'BotSink_alpha9.monitor');
  assert.equal(isBotAudioSource('BotSink_ABC012.monitor'), true);
  for (const source of [
    'BotSink_.monitor',
    'BotSink_bad-name.monitor',
    'BotSink_ok.monitor.wav',
    '/tmp/BotSink_ok.monitor',
    'Default.monitor',
    undefined,
  ]) {
    assert.equal(isBotAudioSource(source), false, String(source));
    assert.throws(() => validateBotAudioSource(source), TypeError);
  }
});

test('BOT初期化はsetTalk(true)を一度だけ呼び、already-onを反転しない', () => {
  const calls = [];
  const session = { setTalk: value => calls.push(value) };
  assert.equal(enableBotAudio(session, 'BotSink_runner.monitor'), session);
  assert.deepEqual(calls, [true]);
});


test('CLIソース指定は値形式・重複・equals形式を拒否する', () => {
  assert.equal(parseBotAudioSource(['--bot-audio-source', 'BotSink_a1.monitor']), 'BotSink_a1.monitor');
  assert.equal(parseBotAudioSource([]), null);
  for (const args of [
    ['--bot-audio-source'],
    ['--bot-audio-source', 'bad'],
    ['--bot-audio-source=x'],
    ['--bot-audio-source', 'BotSink_a.monitor', '--bot-audio-source', 'BotSink_b.monitor'],
  ]) assert.throws(() => parseBotAudioSource(args), TypeError);
});

test('配信部屋ではBOT音声を有効化せずsetTalkもしない', () => {
  let calls = 0;
  const session = { room: { canTalk: false }, setTalk: () => { calls++; } };
  assert.equal(enableBotAudio(session, 'BotSink_stream.monitor'), session);
  assert.equal(calls, 0);
});

test('オフライン capability checkは契約文字列だけを出力する', () => {
  const result = spawnSync(process.execPath, [modulePath, '--check'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, BOT_AUDIO_CONTRACT);
  assert.equal(result.stderr, '');
});
