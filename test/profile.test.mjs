import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveProfile, loadProfile, profilePath } from '../lib/profile.mjs';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-test-')); process.env.XDG_CONFIG_HOME = dir; });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('名乗り：覚えていなければ既定（ゲスト・💻）', () => {
  assert.deepEqual(resolveProfile({}), { profile: { name: 'ゲスト', emoji: '💻' }, saved: false });
});

test('名乗り：--name / --emoji を覚えて、次から使う', () => {
  assert.equal(resolveProfile({ name: 'qramo', emoji: '🦉' }).saved, true);
  assert.deepEqual(loadProfile(), { name: 'qramo', emoji: '🦉' });
  assert.deepEqual(resolveProfile({ emoji: '🐙' }).profile, { name: 'qramo', emoji: '🐙' });
});

test('名乗り：長すぎる名前は 20 文字で切る', () => {
  assert.equal([...resolveProfile({ name: 'あ'.repeat(30) }).profile.name].length, 20);
});

test('名乗り：ファイルが壊れていたら既定に戻る', () => {
  fs.writeFileSync(profilePath(), '{broken');
  assert.deepEqual(loadProfile(), { name: 'ゲスト', emoji: '💻' });
});
