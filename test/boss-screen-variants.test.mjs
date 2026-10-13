import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import blessed from 'blessed';
import { BOSS_SCREEN_VARIANTS, selectBossScreenVariant, startBossScreen } from '../commands/boss-screen.mjs';

function makeScreen() {
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const screen = blessed.screen({ input: new PassThrough(), output, terminal: 'xterm', smartCSR: false, fullUnicode: true });
  screen.program.cols = 100;
  screen.program.rows = 30;
  return screen;
}

test('起動時抽選はゲーム風5%、残りは3種類の業務画面に振り分ける', () => {
  const cases = [
    [0.049999, BOSS_SCREEN_VARIANTS.ARCADE],
    [0.05, BOSS_SCREEN_VARIANTS.WEEKLY_MEMO],
    [0.37, BOSS_SCREEN_VARIANTS.LOTUS_SHEET],
    [0.70, BOSS_SCREEN_VARIANTS.PROJECT_STATUS],
    [0.999999, BOSS_SCREEN_VARIANTS.PROJECT_STATUS]
  ];
  for (const [draw, expected] of cases) {
    let calls = 0;
    assert.equal(selectBossScreenVariant(() => { calls++; return draw; }), expected);
    assert.equal(calls, 1, 'each selection consumes exactly one random draw');
  }
});

test('選択済み画面はリサイズ後も抽選し直さず、従来どおり任意キーで閉じられる', () => {
  const screen = makeScreen();
  const selectedVariant = BOSS_SCREEN_VARIANTS.LOTUS_SHEET;
  const boss = startBossScreen(screen, { variant: selectedVariant });
  try {
    const overlay = screen.children.at(-1);
    const sheet = overlay.children[0];
    assert.match(sheet.options.label, /Lotus 1-2-3風/u);
    assert.match(sheet.options.content, /月次計画/u);

    screen.emit('resize');
    assert.equal(screen.children.at(-1), overlay);
    assert.match(screen.children.at(-1).children[0].options.label, /Lotus 1-2-3風/u);
    assert.equal(boss.active, true);

    screen.program.emit('keypress', 'x', { name: 'x', full: 'x' });
    assert.equal(boss.active, false);
    assert.equal(screen.children.includes(overlay), false);
  } finally {
    boss.close({ render: false });
    screen.destroy();
  }
});

test('業務メモ・進捗・レトロゲームの各バリエーションを描画できる', () => {
  const screen = makeScreen();
  const cases = [
    [BOSS_SCREEN_VARIANTS.WEEKLY_MEMO, /週次共有メモ/u],
    [BOSS_SCREEN_VARIANTS.PROJECT_STATUS, /開発プロジェクト進捗/u],
    [BOSS_SCREEN_VARIANTS.ARCADE, /STAR PATROL/u]
  ];
  try {
    for (const [variant, marker] of cases) {
      const boss = startBossScreen(screen, { variant });
      const overlay = screen.children.at(-1);
      assert.match(overlay.children[0].options.label, marker);
      boss.close({ render: false });
    }
  } finally {
    screen.destroy();
  }
});
