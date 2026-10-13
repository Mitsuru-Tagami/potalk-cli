import blessed from 'blessed';

/**
 * TUI上に一時表示する週次メモ風のボス画面。
 * 開いている間は背後の画面へのキー・マウス操作を止め、任意のキーで元へ戻す。
 */
export function startBossScreen(screen, { onClose = () => {} } = {}) {
  const previousFocus = screen.focused;
  const previousGrabKeys = screen.grabKeys;
  const previousClickables = screen.clickable.slice();
  let active = true;
  let overlay;
  let keyListener;

  const close = ({ render = true } = {}) => {
    if (!active) return;
    active = false;
    if (keyListener) screen.program.removeListener('keypress', keyListener);
    keyListener = null;
    screen.grabKeys = previousGrabKeys;
    overlay?.hide();
    overlay?.destroy();
    overlay = null;
    screen.clickable = previousClickables;
    if (previousFocus && screen.focused !== previousFocus) previousFocus.focus();
    if (render) screen.render();
    onClose();
  };

  screen.grabKeys = true;
  overlay = blessed.box({
    parent: screen, top: 0, left: 0, width: '100%', height: '100%',
    style: { fg: 'white', bg: 'black' }, tags: false,
    clickable: true, keyable: true, autoFocus: false
  });
  // 全面レイヤーだけを配送先にして、背後の画面へマウスを通さない。
  overlay.on('mouse', () => {});
  overlay.on('click', () => {});
  screen.clickable = [overlay];

  const updatedAt = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  blessed.box({
    parent: overlay, top: 'center', left: 'center', width: '88%', height: 17,
    border: { type: 'line' }, label: ' 週次共有メモ ',
    content: [
      `更新 ${updatedAt}     チーム共有`,
      '',
      '今週の確認事項',
      '  [済] 定例向けの進捗を整理',
      '  [中] リリースチェック項目を確認',
      '  [予] 次回レビューの議題をまとめる',
      '',
      '項目             状況       メモ',
      'UI改善           進行中     表示を確認',
      '運用メモ         確認中     手順書を更新',
      '定例準備         完了       アジェンダを共有',
      '',
      '次回の予定: チーム定例（木曜 14:00）',
      '',
      '共有メモを表示中'
    ].join('\n'),
    style: { fg: 'white', bg: 'black', border: { fg: 'cyan' } }, tags: false
  });

  keyListener = () => close();
  screen.program.on('keypress', keyListener);
  overlay.focus();
  screen.render();

  return {
    get active() { return active; },
    close
  };
}

/** F12で画面を開く。入力欄やモーダルにフォーカス中なら開かない。 */
export function bindBossScreenShortcut(screen, { onOpen, isEnabled = () => true, isActive = () => false }) {
  const onKeypress = (_ch, key) => {
    if (key?.name !== 'f12' || !isEnabled() || isActive()) return;
    onOpen();
  };
  screen.program.on('keypress', onKeypress);
  return () => screen.program.removeListener('keypress', onKeypress);
}
