// 移行の合格基準：パック経由の出力が、従来の実装（poems.mjs / fortune.mjs / dice.mjs）と一致すること。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareCommandPacks } from '../lib/command-pack-store.mjs';
import { runPackCommand } from '../lib/command-packs.mjs';
import { selectRandomHaiku, selectRandomWaka } from '../lib/poems.mjs';
import { createHoroscopeResult, createOmikujiResult, createSeizaResult } from '../lib/fortune.mjs';
import { rollDice } from '../lib/dice.mjs';
import { allBundledPackOptions } from './helpers/packs.mjs';

const { dispatch } = prepareCommandPacks({
  userDir: '/nonexistent-ptk-parity',
  activationPath: '/nonexistent-ptk-parity.json',
  enableAllBundled: true,
  persistSeen: false,
});
const pack = name => dispatch.get(name).pack;

// 決定的な乱数：与えた割合の列を順に消費する
const scripted = fractions => {
  let i = 0;
  return (min, max) => min + Math.floor(fractions[i++ % fractions.length] * (max - min));
};

test('同梱パックがすべて配線されている', () => {
  assert.ok(allBundledPackOptions.packDispatch.size >= 7);
  for (const name of ['/omikuji', '/dice', '/waka', '/haiku', '/seiza', '/uranai', '/waza']) {
    assert.ok(dispatch.has(name), name);
  }
});

test('/omikuji の出力が従来と一致する', () => {
  for (const f of [[0], [0.2], [0.5], [0.99]]) {
    const legacy = createOmikujiResult({ randomIntImpl: scripted(f) });
    const viaPack = runPackCommand(pack('/omikuji'), '/omikuji', '', { randomIntImpl: scripted(f) });
    assert.equal(viaPack.message, legacy.message);
  }
});

test('/waka /haiku の出力が従来と一致する', () => {
  for (const f of [[0], [0.123], [0.999]]) {
    assert.equal(
      runPackCommand(pack('/waka'), '/waka', '', { randomIntImpl: scripted(f) }).message,
      selectRandomWaka(scripted(f)),
    );
    assert.equal(
      runPackCommand(pack('/haiku'), '/haiku', '', { randomIntImpl: scripted(f) }).message,
      selectRandomHaiku(scripted(f)),
    );
  }
  // 引数を付けたときのエラーも従来どおり
  assert.equal(runPackCommand(pack('/waka'), '/waka', 'x').error, '使用方法：/waka');
  assert.equal(runPackCommand(pack('/haiku'), '/haiku', 'x').error, '使用方法：/haiku');
});

test('/seiza の出力とエラーが従来と一致する', () => {
  for (const arg of ['射手', 'いて座', 'オリオン座', 'Sgr', 'andromeda']) {
    assert.equal(
      runPackCommand(pack('/seiza'), '/seiza', arg).message,
      createSeizaResult(arg).message,
      arg,
    );
  }
  assert.equal(
    runPackCommand(pack('/seiza'), '/seiza', 'そんな座').error,
    createSeizaResult('そんな座').error,
  );
  for (const f of [[0], [0.5], [0.99]]) {
    assert.equal(
      runPackCommand(pack('/seiza'), '/seiza', '', { randomIntImpl: scripted(f) }).message,
      createSeizaResult('', { randomIntImpl: scripted(f) }).message,
    );
  }
});

test('/uranai の出力とエラーが従来と一致する', () => {
  for (const f of [[0], [0.4], [0.99]]) {
    assert.equal(
      runPackCommand(pack('/uranai'), '/uranai', '牡羊座', { randomIntImpl: scripted(f) }).message,
      createHoroscopeResult('牡羊座', { randomIntImpl: scripted(f) }).message,
    );
    assert.equal(
      runPackCommand(pack('/uranai'), '/uranai', '', { randomIntImpl: scripted(f) }).message,
      createHoroscopeResult('', { randomIntImpl: scripted(f) }).message,
    );
  }
  assert.equal(
    runPackCommand(pack('/uranai'), '/uranai', 'そんな座').error,
    createHoroscopeResult('そんな座').error,
  );
});

test('/dice の形式とエラーが従来と一致する', () => {
  const viaPack = runPackCommand(pack('/dice'), '/dice', '20');
  assert.ok(viaPack.ok);
  assert.match(viaPack.message, /^🎲 20面ダイス: ([1-9]|1\d|20)$/u);
  assert.equal(runPackCommand(pack('/dice'), '/dice', 'abc').error, rollDice('abc').error);
  assert.equal(runPackCommand(pack('/dice'), '/dice', '1').error, rollDice('1').error);
});

test('/help の行が従来の文面・並びと一致する（空白の詰め方は正規化して比べる）', () => {
  const squash = lines => lines.map(l => l.replace(/\s+/g, ' ').trim());
  assert.deepEqual(squash(allBundledPackOptions.packHelp), [
    '/dice [面数] : ダイスを振る（省略時は6面。出目を部屋に送信）',
    '/waka : 古今和歌集から一首を選んで部屋に送信する',
    '/haiku : 正岡子規の俳句から一句を選んで部屋に送信する',
    '/seiza [星座] : 88星座から解説を選んで部屋に送信する',
    '/uranai [星座] : 12星座占いのひとことを部屋に送信する',
    '/omikuji : 運勢と今日の小さな提案を部屋に送信する',
    '/waza : キャラ名＋必殺技をランダムで部屋に送信する',
  ]);
});
