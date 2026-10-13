import blessed from 'blessed';

export const BOSS_SCREEN_VARIANTS = Object.freeze({
  WEEKLY_MEMO: 'weekly-memo',
  LOTUS_SHEET: 'lotus-sheet',
  PROJECT_STATUS: 'project-status',
  ARCADE: 'arcade'
});

const WORK_VARIANTS = [
  BOSS_SCREEN_VARIANTS.WEEKLY_MEMO,
  BOSS_SCREEN_VARIANTS.LOTUS_SHEET,
  BOSS_SCREEN_VARIANTS.PROJECT_STATUS
];

/** 起動時に一度だけ行う抽選。ゲーム風は5%、残りは3つの業務画面から均等に選ぶ。 */
export function selectBossScreenVariant(random = Math.random) {
  const draw = random();
  if (draw < 0.05) return BOSS_SCREEN_VARIANTS.ARCADE;
  const workIndex = Math.min(WORK_VARIANTS.length - 1, Math.floor(((draw - 0.05) / 0.95) * WORK_VARIANTS.length));
  return WORK_VARIANTS[workIndex];
}

function showWeeklyMemo(overlay) {
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
}

function showLotusSheet(overlay) {
  blessed.box({
    parent: overlay, top: 'center', left: 'center', width: '90%', height: 18,
    border: { type: 'line' }, label: ' Lotus 1-2-3風ワークシート  |  TEAM.WK1 ',
    content: [
      ' File   Edit   Range   Copy   Move   Print   Graph   Data',
      ' ────────────────────────────────────────────────────────',
      ' Worksheet: 月次計画                                      ',
      '       A           B           C           D           E',
      '   +-----------+-----------+-----------+-----------+-----------+',
      ' 1 | 部門      | 予算      | 実績      | 差額      | 進捗      |',
      '   +-----------+-----------+-----------+-----------+-----------+',
      ' 2 | 開発      | 1,200,000 | 1,050,000 |   150,000 |  87.5%    |',
      ' 3 | 運用      |   480,000 |   462,000 |    18,000 |  96.3%    |',
      ' 4 | 広報      |   320,000 |   298,000 |    22,000 |  93.1%    |',
      ' 5 | 合計      | 2,000,000 | 1,810,000 |   190,000 |  90.5%    |',
      '   +-----------+-----------+-----------+-----------+-----------+',
      ' Range: A1..E5       Contents: Value       Cell: B5',
      '',
      ' / Ready                                      F1 Help   F2 Edit'
    ].join('\n'),
    style: { fg: 'green', bg: 'black', border: { fg: 'green' } }, tags: false
  });
}

function showProjectStatus(overlay) {
  const updatedAt = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  blessed.box({
    parent: overlay, top: 'center', left: 'center', width: '88%', height: 17,
    border: { type: 'line' }, label: ' 開発プロジェクト進捗 ',
    content: [
      `最終更新 ${updatedAt}  |  チーム: プラットフォーム`,
      '',
      'マイルストーン             担当       期限       状態',
      '──────────────────────────────────────────────────',
      'API仕様レビュー             佐藤       10/15      完了',
      'ステージング反映            鈴木       10/17      進行中',
      '運用チェックリスト          高橋       10/20      未着手',
      'リリース判定会              全員       10/22      予定',
      '',
      '今週の進捗  ███████░░░  72%',
      '',
      '懸案: 検証環境のログ保管期間を確認',
      '次のアクション: レビュー結果を共有',
      '',
      'ステータス: 予定どおり'
    ].join('\n'),
    style: { fg: 'white', bg: 'black', border: { fg: 'blue' } }, tags: false
  });
}

function showArcade(overlay) {
  blessed.box({
    parent: overlay, top: 'center', left: 'center', width: '82%', height: 19,
    border: { type: 'line' }, label: ' STAR PATROL // DEMO ',
    content: [
      '              *          .         *',
      '',
      '       .              /\\                *',
      '                    __/  \\__',
      '     *       .     /  _  _  \\       .',
      '                  |  / \\/ \\  |',
      '        .         |  \\_/\\_/  |',
      '                   \\________/',
      '      v  v  v         |  |        v  v',
      '',
      '       SCORE 000125     HIGH SCORE 009999',
      '       LEVEL 03         SHIELDS  ***',
      '',
      '            INSERT COIN   PRESS START',
      '',
      '               DEMO MODE - PLAYER 1'
    ].join('\n'),
    style: { fg: 'yellow', bg: 'black', border: { fg: 'magenta' } }, tags: false
  });
}

const renderers = {
  [BOSS_SCREEN_VARIANTS.WEEKLY_MEMO]: showWeeklyMemo,
  [BOSS_SCREEN_VARIANTS.LOTUS_SHEET]: showLotusSheet,
  [BOSS_SCREEN_VARIANTS.PROJECT_STATUS]: showProjectStatus,
  [BOSS_SCREEN_VARIANTS.ARCADE]: showArcade
};

/**
 * TUI上に一時表示する偽装画面。画面種別は呼び出し元で選び、リサイズや再描画では変更しない。
 * 開いている間は背後の画面へのキー・マウス操作を止め、任意のキーで元へ戻す。
 */
export function startBossScreen(screen, { onClose = () => {}, variant = BOSS_SCREEN_VARIANTS.WEEKLY_MEMO } = {}) {
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

  (renderers[variant] || showWeeklyMemo)(overlay);

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
