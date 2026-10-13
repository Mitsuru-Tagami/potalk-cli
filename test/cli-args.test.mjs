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
    konami: true,
    boss: false
  });
});

test('通常の起動ではテスト用コナミ起動を無効にする', () => {
  const parsed = parseCliArgs([]);
  assert.equal(parsed.cmd, 'lobby');
  assert.equal(parseLobbyOptions(parsed.rest).konami, false);
  assert.equal(parseLobbyOptions(parsed.rest).boss, false);
});

test('ptk --boss はロビー起動時にboss画面を開く一時テストオプションとして扱われる', () => {
  const parsed = parseCliArgs(['--boss', '--no-sound']);
  assert.equal(parsed.cmd, 'lobby');
  assert.deepEqual(parseLobbyOptions(parsed.rest), {
    sound: false,
    tts: null,
    konami: false,
    boss: true
  });
});

test('--konami を指定しても help は従来どおりヘルプを表示する', () => {
  const parsed = parseCliArgs(['--help', '--konami']);
  assert.equal(parsed.cmd, '--help');
  const result = spawnSync(process.execPath, [new URL('../ptk.mjs', import.meta.url).pathname, '--help', '--konami'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /POT-TALK CLI/u);
  assert.doesNotMatch(result.stdout, /--konami/u);
  assert.doesNotMatch(result.stdout, /--boss/u);
});

test('ptk --mic-test はSoX不在を案内して失敗終了する', () => {
  const script = new URL('../ptk.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script, '--mic-test'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '' }
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /既定のマイク入力/u);
  assert.match(result.stderr, /SoXの rec コマンドが見つかりません/u);
});
