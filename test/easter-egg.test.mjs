import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import blessed from 'blessed';
import {
  AULD_LANG_SYNE_DURATION_MS,
  AULD_LANG_SYNE_MML,
  KONAMI_KEY_SEQUENCE_LABEL,
  KONAMI_SEQUENCE,
  bindKonamiKeySequence,
  parseMml,
  renderMmlPcm,
  startMmlPlayback
} from '../lib/easter-egg.mjs';
import { startEasterEggScreen } from '../commands/easter-egg-screen.mjs';

function makeScreen() {
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const screen = blessed.screen({ input: new PassThrough(), output, terminal: 'xterm', smartCSR: false });
  screen.program.cols = 80;
  screen.program.rows = 24;
  let renderCalls = 0;
  const render = screen.render.bind(screen);
  screen.render = (...args) => { renderCalls++; return render(...args); };
  Object.defineProperty(screen, 'renderCalls', { get: () => renderCalls });
  return screen;
}

function makeChild() {
  const chunks = [];
  const stdin = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const child = new EventEmitter();
  child.stdin = stdin;
  child.exitCode = null;
  child.killed = false;
  child.kill = signal => { child.killed = true; child.signal = signal; return true; };
  return { child, chunks };
}

function makeTimers() {
  const tasks = new Set();
  const cleared = [];
  return {
    tasks,
    cleared,
    setInterval(fn, ms) { const task = { fn, ms }; tasks.add(task); return task; },
    clearInterval(task) { tasks.delete(task); cleared.push(task); }
  };
}

function chunkLength(chunks) { return chunks.reduce((sum, chunk) => sum + chunk.length, 0); }

test('秘密配列は実際のキーイベントだけで判定し、大文字B/Aも受け付ける', () => {
  assert.deepEqual(KONAMI_SEQUENCE, ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a']);
  assert.equal(KONAMI_KEY_SEQUENCE_LABEL, '↑↑↓↓←→←→BA');
  const program = new EventEmitter();
  let matches = 0;
  const unbind = bindKonamiKeySequence(program, { onMatch: () => { matches++; } });
  const press = name => program.emit('keypress', name, { name });
  try {
    press('up');
    press('down'); // 誤入力で途中状態をリセット
    for (const name of [...KONAMI_SEQUENCE.slice(0, -2), 'B', 'A']) press(name);
    assert.equal(matches, 1);
    unbind();
    for (const name of KONAMI_SEQUENCE) press(name);
    assert.equal(matches, 1, '解除後はキー列を検出しない');
  } finally {
    unbind();
  }
});

test('MMLを音符イベントへ展開し、合成PCMは音声データを持つ', () => {
  const events = parseMml('T120 O4 L4 C4. C8 R4');
  assert.deepEqual(events.map(event => Math.round(event.durationMs)), [750, 250, 500]);
  assert.equal(events[0].frequency, 440 * (2 ** ((60 - 69) / 12)));
  assert.equal(events[2].frequency, null);

  const melody = parseMml(AULD_LANG_SYNE_MML);
  assert.ok(melody.length >= 20);
  assert.ok(AULD_LANG_SYNE_DURATION_MS > 5000);
  const pcm = renderMmlPcm('T120 O4 L4 A4');
  assert.equal(pcm.length, 22050);
  let audibleSample = false;
  for (let offset = 0; offset < pcm.length; offset += 2) {
    if (pcm.readInt16LE(offset) !== 0) { audibleSample = true; break; }
  }
  assert.equal(audibleSample, true);
});

test('SoX再生はMMLのPCMを一度だけ流し、停止要求で子プロセスを終了する', () => {
  const state = makeChild();
  let spawnCount = 0;
  let args;
  const stop = startMmlPlayback('T120 O4 L4 A4', {
    spawnImpl: (command, argv, options) => {
      spawnCount++;
      assert.equal(command, 'play');
      args = argv;
      assert.deepEqual(options.stdio, ['pipe', 'ignore', 'ignore']);
      return state.child;
    }
  });
  assert.equal(spawnCount, 1);
  assert.equal(args[0], '-q');
  assert.ok(chunkLength(state.chunks) > 0);
  stop();
  stop();
  assert.equal(state.child.killed, true);
  assert.equal(state.child.signal, 'SIGTERM');
});

test('SoXが見つからない場合も失敗を表に出さず無音で継続できる', () => {
  assert.doesNotThrow(() => {
    const stop = startMmlPlayback('T120 O4 L4 A4', { spawnImpl: () => { throw new Error('ENOENT'); } });
    stop();
  });
});

test('任意キーでスタッフロールを閉じ、タイマー・音声・画面状態を復元する', () => {
  const screen = makeScreen();
  const beforeChildren = screen.children.length;
  const beforeClickables = screen.clickable.slice();
  const timers = makeTimers();
  const audio = makeChild();
  let underlyingMute = 0;
  screen.key('m', () => { underlyingMute++; });
  const mode = startEasterEggScreen(screen, {
    spawnImpl: () => audio.child,
    setIntervalImpl: timers.setInterval,
    clearIntervalImpl: timers.clearInterval
  });
  assert.equal(mode.active, true);
  assert.equal(screen.grabKeys, true);
  assert.equal(timers.tasks.size, 1);
  assert.ok(chunkLength(audio.chunks) > 0);
  assert.ok(screen.renderCalls > 0, 'the overlay should request a terminal redraw');

  screen.program.emit('keypress', 'm', { name: 'm' });
  assert.equal(mode.active, false);
  assert.equal(underlyingMute, 0);
  assert.equal(timers.tasks.size, 0);
  assert.equal(timers.cleared.length, 1);
  assert.equal(audio.child.killed, true);
  assert.equal(screen.grabKeys, false);
  assert.deepEqual(screen.clickable, beforeClickables);
  assert.equal(screen.children.length, beforeChildren);
  screen.destroy();
});

test('端末リサイズによる再描画後もタイマー・音声を中断して画面を復元できる', () => {
  const screen = makeScreen();
  const timers = makeTimers();
  const audio = makeChild();
  const mode = startEasterEggScreen(screen, {
    spawnImpl: () => audio.child,
    setIntervalImpl: timers.setInterval,
    clearIntervalImpl: timers.clearInterval
  });
  const renderCount = screen.renderCalls;
  screen.program.rows = 30;
  screen.emit('resize');
  assert.equal(mode.active, true);
  assert.ok(screen.renderCalls > renderCount, 'resize should redraw the active overlay');

  mode.close({ render: false });
  assert.equal(mode.active, false);
  assert.equal(timers.tasks.size, 0);
  assert.equal(audio.child.killed, true);
  assert.equal(screen.grabKeys, false);
  screen.destroy();
});

test('Ctrl-C中断は演出を片付けてからCLI終了コールバックを呼ぶ', () => {
  const screen = makeScreen();
  const timers = makeTimers();
  let interrupted = 0;
  const mode = startEasterEggScreen(screen, {
    sound: false,
    onInterrupt: () => { interrupted++; },
    setIntervalImpl: timers.setInterval,
    clearIntervalImpl: timers.clearInterval
  });
  screen.program.emit('keypress', '\u0003', { name: 'C-c', ctrl: true });
  assert.equal(mode.active, false);
  assert.equal(interrupted, 1);
  assert.equal(timers.tasks.size, 0);
  assert.equal(screen.grabKeys, false);
  screen.destroy();
});

test('TUIの画面終了経路でcloseするとアニメーションタイマーを破棄する', () => {
  const screen = makeScreen();
  const timers = makeTimers();
  let spawns = 0;
  const mode = startEasterEggScreen(screen, {
    sound: false,
    spawnImpl: () => { spawns++; throw new Error('sound should be disabled'); },
    setIntervalImpl: timers.setInterval,
    clearIntervalImpl: timers.clearInterval
  });
  assert.equal(spawns, 0);
  mode.close({ render: false });
  assert.equal(mode.active, false);
  assert.equal(timers.tasks.size, 0);
  assert.equal(timers.cleared.length, 1);
  assert.equal(screen.grabKeys, false);
  screen.destroy();
});

test('スクロール完了で画面とタイマーを自動復帰する', () => {
  const screen = makeScreen();
  const timers = makeTimers();
  const mode = startEasterEggScreen(screen, {
    sound: false,
    setIntervalImpl: timers.setInterval,
    clearIntervalImpl: timers.clearInterval,
    stepMs: 100
  });
  const task = [...timers.tasks][0];
  for (let i = 0; i < 100 && mode.active; i++) task.fn();
  assert.equal(mode.active, false);
  assert.equal(timers.tasks.size, 0);
  assert.equal(screen.grabKeys, false);
  screen.destroy();
});
