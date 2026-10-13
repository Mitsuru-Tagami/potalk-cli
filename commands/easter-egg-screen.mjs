import blessed from 'blessed';
import {
  AULD_LANG_SYNE_DURATION_MS,
  AULD_LANG_SYNE_MML,
  startMmlPlayback
} from '../lib/easter-egg.mjs';

const STEP_MS = 120;
const CREDITS = [
  '  .----------------------------------.  ',
  '  |       P O T - T A L K   C L I     |  ',
  '  |             THE END              |  ',
  '  `----------------------------------`  ',
  '',
  '                 STAFF ROLL',
  '',
  '                 Presented by',
  '                  potalk-cli',
  '',
  '                 Lead Developer',
  '                  THE PLAYER',
  '',
  '                 Code & tea',
  '                 Helpful humans',
  '',
  '                 Music',
  '        Auld Lang Syne — tiny synth edition',
  '          notes: hand-entered MML',
  '',
  '                 Sound driver',
  '              SoX play (optional)',
  '',
  '             Audio asset size: 0 bytes',
  '             No chat was sent. Promise.',
  '',
  '        Thank you for finding the secret.',
  '         May your next room be cozy.',
  '',
  '                 FIN',
  '          Press any key to return'
];

/** 全画面レイヤーで短いスタッフロールを流し、閉じる際はキー・タイマー・音を元へ戻す。 */
export function startEasterEggScreen(screen, {
  sound = true,
  onInterrupt = () => {},
  onClose = () => {},
  spawnImpl,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  stepMs = STEP_MS
} = {}) {
  const previousGrabKeys = screen.grabKeys;
  const previousClickables = Array.isArray(screen.clickable) ? screen.clickable.slice() : null;
  const previousFocus = screen.focused;
  let closed = false;
  let frame = 0;
  let timer = null;

  screen.grabKeys = true;
  const overlay = blessed.box({
    parent: screen, top: 0, left: 0, width: '100%', height: '100%',
    style: { fg: 'green', bg: 'black' }, tags: false, clickable: true, keyable: true
  });
  overlay.on('mouse', () => {});
  overlay.on('click', () => {});
  screen.clickable = [overlay];

  const credits = blessed.box({
    parent: overlay, top: 0, left: 0, width: '100%', height: '100%',
    align: 'center', valign: 'top', style: { fg: 'green', bg: 'black', bold: true }, tags: false
  });
  const finale = blessed.box({
    parent: overlay, top: 'center', left: 'center', width: '80%', height: 5,
    content: '★  FIN  ★\n\nThanks for playing.', align: 'center', valign: 'middle',
    style: { fg: 'yellow', bg: 'black', bold: true }, tags: false, hidden: true
  });

  const stopAudio = sound
    ? startMmlPlayback(AULD_LANG_SYNE_MML, spawnImpl ? { spawnImpl } : {})
    : () => {};
  const visibleRows = () => Math.max(1, Number(screen.program?.rows || screen.height) || 24);
  const rollFrames = CREDITS.length + visibleRows();
  const totalFrames = Math.max(rollFrames, Math.ceil((sound ? AULD_LANG_SYNE_DURATION_MS + 500 : 0) / stepMs));

  function close({ render = true } = {}) {
    if (closed) return false;
    closed = true;
    if (timer !== null) clearIntervalImpl(timer);
    screen.program?.removeListener('keypress', onKeypress);
    screen.removeListener('resize', renderFrame);
    stopAudio();
    screen.grabKeys = previousGrabKeys;
    if (previousClickables) screen.clickable = previousClickables;
    overlay.destroy();
    try {
      if (previousFocus && !previousFocus.destroyed && typeof previousFocus.focus === 'function') previousFocus.focus();
    } catch { /* 画面全体を閉じる途中なら、フォーカス復元は不要 */ }
    onClose();
    if (render) screen.render();
    return true;
  }

  function renderFrame() {
    if (closed) return;
    const rows = visibleRows();
    const visible = Array(rows).fill('');
    for (let i = 0; i < CREDITS.length && i <= frame; i++) {
      const y = frame - i;
      if (y >= 0 && y < rows) visible[y] = CREDITS[i];
    }
    credits.setContent(visible.join('\n'));
    const creditsFinished = frame >= rollFrames - 1;
    credits.hidden = creditsFinished;
    finale.hidden = !creditsFinished;
    screen.render();
  }

  function onKeypress(_ch, key = {}) {
    const interrupt = key.name === 'C-c' || (key.ctrl && String(key.name).toLowerCase() === 'c');
    close();
    if (interrupt) {
      try {
        const pending = onInterrupt();
        pending?.catch?.(() => {});
      } catch { /* 画面復帰を先に完了したうえで終了要求を優先する */ }
    }
  }

  screen.program?.on('keypress', onKeypress);
  screen.on('resize', renderFrame);
  overlay.focus();
  renderFrame();
  timer = setIntervalImpl(() => {
    frame++;
    if (frame >= totalFrames) { close(); return; }
    renderFrame();
  }, stepMs);
  timer?.unref?.();

  return {
    close,
    get active() { return !closed; }
  };
}
