import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveProfile, loadProfile, profilePath, randomCoffeeName } from '../lib/profile.mjs';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-test-')); process.env.XDG_CONFIG_HOME = dir; });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('名乗り：初めてならコーヒーの名前を引いて覚える（次も同じ名前）', () => {
  const first = resolveProfile({});
  assert.equal(first.saved, false);
  assert.equal(first.profile.emoji, '💻');
  assert.match(first.profile.name, /^.+(ブラジル|コロンビア|エチオピア|モカ|キリマンジャロ|マンデリン|グアテマラ|コスタリカ|ケニア|ブルーマウンテン|コナ|トラジャ|イルガチェフェ|ゲイシャ|パナマ|ホンジュラス|ルワンダ|エルサルバドル|ペルー|イエメン|タンザニア)$/);
  assert.deepEqual(loadProfile(), first.profile);
});

test('コーヒーの名前：名前の上限（20 文字）に収まる', () => {
  for (let i = 0; i < 2000; i++) assert.ok([...randomCoffeeName()].length <= 20);
});

test('名乗り：--name / --emoji を覚えて、次から使う', () => {
  assert.equal(resolveProfile({ name: 'qramo', emoji: '🦉' }).saved, true);
  assert.deepEqual(loadProfile(), { name: 'qramo', emoji: '🦉' });
  assert.deepEqual(resolveProfile({ emoji: '🐙' }).profile, { name: 'qramo', emoji: '🐙' });
});

test('名乗り：長すぎる名前は 20 文字で切る', () => {
  assert.equal([...resolveProfile({ name: 'あ'.repeat(30) }).profile.name].length, 20);
});

test('名乗り：ファイルが壊れていたら、新しくコーヒーの名前を引き直す', () => {
  fs.writeFileSync(profilePath(), '{broken');
  const p = loadProfile();
  assert.ok(p.name && p.name !== 'ゲスト');
  assert.deepEqual(loadProfile(), p);   // 引き直した名前を覚えている
});
