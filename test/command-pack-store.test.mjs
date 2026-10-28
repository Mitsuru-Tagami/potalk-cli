import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  activateInactivePacks,
  loadActivation,
  prepareCommandPacks,
  saveActivation,
  togglePackState,
} from '../lib/command-pack-store.mjs';

function makePack(base, name, version = '1.0.0') {
  const dir = path.join(base, name);
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  writeFileSync(path.join(dir, 'command.json'), JSON.stringify({
    contract: 'potalk-command-v1', name, title: `${name}パック`, author: 'テスト', version,
    commands: [{ name: `/${name}`, usage: `/${name}`, description: 'テスト用', engine: 'pool', pool: 'data/x.json', format: '{text}' }],
  }));
  writeFileSync(path.join(dir, 'data', 'x.json'), JSON.stringify([{ text: 'テスト文' }]));
  return dir;
}

function makeWorld() {
  const root = mkdtempSync(path.join(tmpdir(), 'ptk-store-'));
  const bundledDir = path.join(root, 'bundled');
  const userDir = path.join(root, 'user');
  mkdirSync(bundledDir, { recursive: true });
  mkdirSync(userDir, { recursive: true });
  makePack(bundledDir, 'omikuji'); // 標準パックの名前
  makePack(bundledDir, 'waza');    // 同梱の拡張パック
  makePack(userDir, 'mine');       // 利用者配置パック
  return { root, bundledDir, userDir, activationPath: path.join(root, 'command-packs.json') };
}

test('標準パックは最初から有効、拡張と利用者配置は未有効化として警告される', () => {
  const w = makeWorld();
  const r = prepareCommandPacks({ ...w, persistSeen: false });
  assert.ok(r.dispatch.has('/omikuji'));
  assert.ok(!r.dispatch.has('/waza'));
  assert.ok(!r.dispatch.has('/mine'));
  assert.deepEqual(r.inactive.map(x => x.pack.name).sort(), ['mine', 'waza']);
  assert.ok(r.inactive.every(x => x.reason === 'new'));
  assert.ok(r.startupLines.some(l => l.includes('標準コマンド：/omikuji')));
  assert.ok(r.startupLines.some(l => l.includes('有効化されていません')));
});

test('有効化すると次回から使え、導入ログは1回だけ出る', () => {
  const w = makeWorld();
  const act = activateInactivePacks(w);
  assert.equal(act.activated.length, 2);
  assert.ok(act.lines.some(l => l.includes('追加コマンド：/waza')));
  const r = prepareCommandPacks({ ...w, persistSeen: true });
  assert.ok(r.dispatch.has('/waza') && r.dispatch.has('/mine'));
  assert.equal(r.inactive.length, 0);
  assert.ok(!r.startupLines.some(l => (l.includes('/waza') || l.includes('/mine')) && l.includes('導入しました')), '導入ログは有効化時に出たので起動時は出ない（標準パックの初回分は除く）');
});

test('標準パックは無効化できる', () => {
  const w = makeWorld();
  const activation = loadActivation(w.activationPath);
  activation.disabled = ['omikuji'];
  saveActivation(w.activationPath, activation);
  const r = prepareCommandPacks({ ...w, persistSeen: false });
  assert.ok(!r.dispatch.has('/omikuji'));
});

test('版が変わったパックは「更新」として再有効化を求める', () => {
  const w = makeWorld();
  activateInactivePacks(w);
  makePack(w.bundledDir, 'waza', '1.1.0');
  const r = prepareCommandPacks({ ...w, persistSeen: false });
  const waza = r.inactive.find(x => x.pack.name === 'waza');
  assert.ok(waza && waza.reason === 'updated');
  assert.ok(r.startupLines.some(l => l.includes('更新されました')));
});

test('壊れたパックは errors に出して飛ばし、他のパックは生かす', () => {
  const w = makeWorld();
  const bad = path.join(w.userDir, 'broken');
  mkdirSync(bad, { recursive: true });
  writeFileSync(path.join(bad, 'command.json'), '{oops');
  const r = prepareCommandPacks({ ...w, persistSeen: false });
  assert.equal(r.errors.length, 1);
  assert.ok(r.dispatch.has('/omikuji'));
});

test('内蔵コマンドと同名のパックコマンドは配線されない', () => {
  const w = makeWorld();
  const dir = path.join(w.userDir, 'evil');
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  writeFileSync(path.join(dir, 'command.json'), JSON.stringify({
    contract: 'potalk-command-v1', name: 'evil', title: '悪さパック', author: 'テスト', version: '1.0.0',
    commands: [{ name: '/card', usage: '/card', description: '乗っ取り', engine: 'pool', pool: 'data/x.json', format: '{text}' }],
  }));
  writeFileSync(path.join(dir, 'data', 'x.json'), JSON.stringify([{ text: 'x' }]));
  // 有効化しても /card は内蔵のまま
  const activation = loadActivation(w.activationPath);
  activation.activated.evil = '1.0.0';
  saveActivation(w.activationPath, activation);
  const r = prepareCommandPacks({ ...w, persistSeen: false });
  assert.ok(!r.dispatch.has('/card'));
  assert.ok(r.notices.some(n => n.includes('内蔵コマンド')));
});

test('追加指定（BOT 内蔵など）のパックは有効化なしで使え、同名コマンドで優先される', () => {
  const w = makeWorld();
  const extraDir = path.join(w.root, 'extra');
  mkdirSync(extraDir, { recursive: true });
  makePack(extraDir, 'omikuji'); // 標準と同じ名前・コマンドのパック
  const r = prepareCommandPacks({ ...w, extraDirs: [extraDir], persistSeen: false });
  assert.ok(r.dispatch.has('/omikuji'));
  assert.equal(r.dispatch.get('/omikuji').pack.title, 'omikujiパック');
  assert.equal(r.states.find(s => s.source === 'extra').state, 'enabled');
});

test('togglePackState で有効／未有効化／無効化を切り替えられる', () => {
  const w = makeWorld();
  assert.equal(togglePackState('waza', w), 'enabled');
  assert.equal(togglePackState('waza', w), 'inactive');
  assert.equal(togglePackState('omikuji', w), 'disabled');
  assert.equal(togglePackState('omikuji', w), 'enabled');
  assert.equal(togglePackState('nope', w), null);
});
