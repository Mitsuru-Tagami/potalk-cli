import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  listPackCommands,
  loadPackFromDir,
  runPackCommand,
  validateManifest,
} from '../lib/command-packs.mjs';

const first = (min, _max) => min; // 常に先頭を選ぶ乱数
const last = (min, max) => max - 1; // 常に末尾を選ぶ乱数

function makePackDir(manifest, files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ptk-pack-'));
  writeFileSync(path.join(dir, 'command.json'), JSON.stringify(manifest));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const baseManifest = {
  contract: 'potalk-command-v1',
  name: 'sample-pack',
  title: 'サンプルパック',
  author: 'テスト職人',
  version: '1.0.0',
  commands: [
    {
      name: '/food', usage: '/food', description: '食べ物を1つ出す', engine: 'pool',
      pool: 'data/foods.json', format: '{text} — {author}',
    },
    {
      name: '/sky', usage: '/sky [星座]', description: '星座の解説', engine: 'pool',
      pool: 'data/sky.json', format: '{name}：{description}',
      key: { field: 'name', aliasesField: 'aliases', extraFields: ['latin', 'abbr'], stripSuffix: '座' },
      errorUsage: '使用方法：/sky [88星座名]',
    },
    {
      name: '/sign', usage: '/sign [星座]', description: '星座占い', engine: 'pool',
      pool: 'data/signs.json', format: '{sign}の占い：{item}',
      key: { field: 'sign' }, errorUsage: '使用方法：/sign [12星座]',
    },
    {
      name: '/waza', usage: '/waza', description: '必殺技を出す', engine: 'combo',
      format: '{prefix}{char}{move}',
      pools: {
        char: 'data/chars.json',
        move: 'data/moves.json',
        prefix: { file: 'data/prefixes.json', rate: 0.5 },
      },
    },
    { name: '/dice', usage: '/dice [面数]', description: 'ダイスを振る', engine: 'dice' },
  ],
};

const baseFiles = {
  'data/foods.json': [
    { text: 'たこ焼き', author: '大阪' },
    { text: '豚まん', author: '神戸' },
  ],
  'data/sky.json': [
    { name: 'いて座', latin: 'Sagittarius', abbr: 'Sgr', description: '弓を構える射手。', aliases: ['射手座', '射手'] },
    { name: 'いるか座', latin: 'Delphinus', abbr: 'Del', description: '海にすむイルカ。' },
  ],
  'data/signs.json': [
    { sign: '牡羊座', items: ['まず一つ片づける。', 'ひらめきを試す。'] },
    { sign: '牡牛座', items: ['いつものペースで。'] },
  ],
  'data/chars.json': ['おねえちゃん', 'つくよみちゃん'],
  'data/moves.json': ['キック', 'パンチ'],
  'data/prefixes.json': ['超', '真'],
};

function loadSample() {
  const dir = makePackDir(baseManifest, baseFiles);
  const result = loadPackFromDir(dir);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.pack;
}

test('validateManifest は正しいマニフェストを通し、契約違い・重複・未知エンジンを弾く', () => {
  assert.equal(validateManifest(baseManifest).ok, true);
  assert.equal(validateManifest({ ...baseManifest, contract: 'potalk-command-v99' }).ok, false);
  assert.equal(validateManifest({ ...baseManifest, name: 'Bad Name' }).ok, false);
  const dup = { ...baseManifest, commands: [baseManifest.commands[0], baseManifest.commands[0]] };
  assert.equal(validateManifest(dup).ok, false);
  const unknown = { ...baseManifest, commands: [{ name: '/x', description: 'x', engine: 'teleport' }] };
  assert.equal(validateManifest(unknown).ok, false);
});

test('loadPackFromDir はプールを読み、フォルダ外参照と壊れた JSON を弾く', () => {
  const pack = loadSample();
  assert.equal(pack.name, 'sample-pack');
  assert.deepEqual(listPackCommands(pack).map(c => c.name), ['/food', '/sky', '/sign', '/waza', '/dice']);

  const evil = { ...baseManifest, commands: [{ ...baseManifest.commands[0], pool: '../secret.json' }] };
  assert.equal(loadPackFromDir(makePackDir(evil, { 'data/foods.json': [] })).ok, false);

  const brokenDir = makePackDir(baseManifest, { ...baseFiles, 'data/foods.json': '{not json' });
  assert.equal(loadPackFromDir(brokenDir).ok, false);
});

test('pool エンジン：ランダムに1件引いて書式化する', () => {
  const pack = loadSample();
  assert.deepEqual(runPackCommand(pack, '/food', '', { randomIntImpl: first }), { ok: true, message: 'たこ焼き — 大阪' });
  assert.deepEqual(runPackCommand(pack, '/food', '', { randomIntImpl: last }), { ok: true, message: '豚まん — 神戸' });
});

test('pool エンジン：キー引きは別名・座の省略・英字略号でも引け、不正な引数はエラー', () => {
  const pack = loadSample();
  assert.equal(runPackCommand(pack, '/sky', '射手', { randomIntImpl: first }).message, 'いて座：弓を構える射手。');
  assert.equal(runPackCommand(pack, '/sky', 'sgr', { randomIntImpl: first }).message, 'いて座：弓を構える射手。');
  assert.equal(runPackCommand(pack, '/sky', '', { randomIntImpl: last }).message, 'いるか座：海にすむイルカ。');
  const bad = runPackCommand(pack, '/sky', 'そんな座', { randomIntImpl: first });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /使用方法/);
});

test('pool エンジン：グループ引きはグループを選んでから中身を1件引く', () => {
  const pack = loadSample();
  assert.equal(runPackCommand(pack, '/sign', '牡羊座', { randomIntImpl: last }).message, '牡羊座の占い：ひらめきを試す。');
  assert.equal(runPackCommand(pack, '/sign', '', { randomIntImpl: first }).message, '牡羊座の占い：まず一つ片づける。');
});

test('combo エンジン：プールを組み合わせ、確率つきの接頭辞を制御できる', () => {
  const pack = loadSample();
  // rate 0.5 判定は randomIntImpl(0,10000) で行う。first は 0 を返すので接頭辞が付く
  assert.equal(runPackCommand(pack, '/waza', '', { randomIntImpl: first }).message, '超おねえちゃんキック');
  // 判定だけ外す乱数：char・move の抽選（1・2回目）は先頭、接頭辞の確率判定（3回目）だけ外す
  let calls = 0;
  const noPrefix = (min, max) => (calls++ === 2 ? max - 1 : min);
  assert.equal(runPackCommand(pack, '/waza', '', { randomIntImpl: noPrefix }).message, 'おねえちゃんキック');
});

test('dice エンジン：既存のダイスと同じ結果形式・エラーになる', () => {
  const pack = loadSample();
  const ok = runPackCommand(pack, '/dice', '20');
  assert.equal(ok.ok, true);
  assert.match(ok.message, /^🎲 20面ダイス: ([1-9]|1\d|20)$/u);
  const bad = runPackCommand(pack, '/dice', 'abc');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /使用方法/);
});

test('出力ガード：改行や制御文字は1行化され、長すぎる結果はエラーになる', () => {
  const dirty = {
    ...baseManifest,
    commands: [baseManifest.commands[0]],
  };
  const dir = makePackDir(dirty, {
    'data/foods.json': [
      { text: 'あ\nい\u200bう', author: 'x' },
      { text: 'あ'.repeat(80), author: 'x' },
    ],
  });
  const { pack } = loadPackFromDir(dir);
  assert.equal(runPackCommand(pack, '/food', '', { randomIntImpl: first }).message, 'あ い う — x');
  assert.equal(runPackCommand(pack, '/food', '', { randomIntImpl: last }).ok, false);
});
