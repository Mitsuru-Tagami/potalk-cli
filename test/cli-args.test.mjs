import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseCliArgs, parseLobbyOptions } from '../lib/cli-args.mjs';

test('ptk --konami はロビー起動時の一時テストオプションとして扱われる', () => {
  const parsed = parseCliArgs(['--konami', '--no-sound']);
  assert.equal(parsed.cmd, 'lobby');
  assert.deepEqual(parseLobbyOptions(parsed.rest), {
    sound: false,
    tts: null,
    konami: true
  });
});

test('通常の起動ではテスト用コナミ起動を無効にする', () => {
  const parsed = parseCliArgs([]);
  assert.equal(parsed.cmd, 'lobby');
  assert.equal(parseLobbyOptions(parsed.rest).konami, false);
});

test('--konami を指定しても help は従来どおりヘルプを表示する', () => {
  const parsed = parseCliArgs(['--help', '--konami']);
  assert.equal(parsed.cmd, '--help');
  const result = spawnSync(process.execPath, [new URL('../ptk.mjs', import.meta.url).pathname, '--help', '--konami'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /POT-TALK CLI/u);
  assert.doesNotMatch(result.stdout, /--konami/u);
});
