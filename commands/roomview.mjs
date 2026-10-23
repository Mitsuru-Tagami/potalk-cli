/**
 * @fileoverview TUI上での部屋画面（チャットおよび通話UI）の描画・制御ロジック。
 * ロビーで部屋を選択した後、または直接部屋を作成・指定した際にこの画面に遷移します。
 *
 * 【今後の拡張ポイント】
 * - ログ画面（チャット履歴）の保存・エクスポート機能
 * - ユーザー選択・メンション（特定の参加者を指定したアクション）
 * - 話している人の音声波形やインジケータのリッチ化
 */

// TUI の部屋画面。ロビーで部屋を選んで Enter → ここ。q で退出するとロビーへ戻る。
//   ┌─ 部屋名 ──────────── 🔈 音あり ─┐
//   │ 参加者（話している人に 🔊）        │
//   ├────────────────────────────────┤
//   │ お知らせ（つながった・ひとこと…）  │
//   ├────────────────────────────────┤
//   │ > 入力欄（ひとことを書く）         │
//   │ キーの説明                        │
//   └────────────────────────────────┘
import blessed from 'blessed';
import { enterRoom } from '../lib/session.mjs';
import { padWidth, tuiText } from '../lib/text.mjs';
import { roomCommandMatches, commonCommandPrefix } from '../lib/commands.mjs';
import { editCardInteractive } from './card-edit.mjs';
import { BOSS_SCREEN_VARIANTS, bindBossScreenShortcut, startBossScreen } from './boss-screen.mjs';
import { formatMicMeter } from '../lib/mic-level.mjs';

const MEMBERS_H = 10;   // 参加者の段の高さ（定員 8 人＋見出し＋余白）
const BOSS_ESCAPE_WINDOW_MS = 350;
const hhmm = () => new Date().toTimeString().slice(0, 5);

/**
 * 部屋に入室し、TUI画面を描画・制御します。
 * @param {object} screen - blessedのscreenインスタンス
 * @param {object} o - オプション
 * @param {{roomId:string, name?:string}} o.target - 対象の部屋情報
 * @param {{name:string, emoji:string}} o.profile - 自身のプロフィール
 * @param {object} o.lobby - ロビーオブジェクト
 * @param {boolean} o.sound - 音声を有効にするか
 * @param {typeof enterRoom} [o.enterRoomImpl=enterRoom] - テスト用のセッション生成関数
 * @returns {{ done: Promise<string|undefined>, close: () => Promise<void> }}
 *   done は退出（q・満員）時にresolveするPromise。
 *   close は外部（Ctrl-Cなど）から強制的に退出・画面破棄させる関数。
 */
export function showRoom(screen, { target, profile, cardManager = null, lobby, sound, tts = null, bossScreenVariant = BOSS_SCREEN_VARIANTS.WEEKLY_MEMO, enterRoomImpl = enterRoom }) {
  let closeRoom;
  const done = new Promise(resolve => {
    const frame = blessed.box({
      parent: screen, top: 0, left: 0, width: '100%', height: '100%',
      border: { type: 'line' }, style: { border: { fg: 'cyan' } }, tags: false
    });
    const members = blessed.box({ parent: frame, top: 0, left: 1, width: '100%-4', height: MEMBERS_H });
    blessed.line({ parent: frame, top: MEMBERS_H, left: 0, width: '100%-2', orientation: 'horizontal', style: { fg: 'gray' } });
    const log = blessed.log({
      parent: frame, top: MEMBERS_H + 1, left: 1, width: '100%-4', height: `100%-${MEMBERS_H + 6}`,
      scrollable: true, alwaysScroll: true, mouse: true, keys: true, vi: true,
      scrollbar: { ch: ' ', style: { bg: 'gray' } }
    });
    blessed.line({ parent: frame, bottom: 3, left: 0, width: '100%-2', orientation: 'horizontal', style: { fg: 'gray' } });
    const input = blessed.textbox({
      parent: frame, bottom: 2, left: 1, width: '100%-4', height: 1,
      inputOnFocus: true, style: { fg: 'white' }
    });
    const help = blessed.box({ parent: frame, bottom: 1, left: 1, width: '100%-4', height: 1, style: { fg: 'gray' } });

    const setHelp = typing => help.setContent(typing
      ? '  Enter: 送る（60文字まで。Tab: コマンド補完。/hbk 番号・/unhbk 番号 ローカルミュート　/tag 話題　/list 部屋一覧　/dice [面数] ダイス　/cp URLコピー） | Esc: やめる'
      : '  F12: ボス画面 | Esc×2: ボス画面 | t: マイク | m: 音 | i: 入力 | q: 退出');
    setHelp(false);

    let session = null, closing = false, cardEditing = false, cardModal = null, cancelCardPrompt = null;
    let bossScreen = null, lastBossEscapeAt = 0;
    const resetBossEscapeSequence = (_ch, key) => { if (key?.name !== 'escape') lastBossEscapeAt = 0; };
    screen.on('keypress', resetBossEscapeSequence);
    const say = text => { log.log(tuiText(`${hhmm()}  ${text}`)); screen.render(); };

    // Blessed の Textbox は Tab を文字として挿入するため、入力処理の前に補完へ回す。
    const inputListener = input._listener;
    input._listener = function(ch, key) {
      if (key.name === 'tab') return completeInput();
      return inputListener.call(this, ch, key);
    };
    function completeInput() {
      const typed = input.getValue();
      const matches = roomCommandMatches(typed);
      if (matches.length === 1) {
        if (matches[0] !== typed) input.setValue(matches[0] + ' ');
      } else if (matches.length > 1) {
        const prefix = commonCommandPrefix(matches);
        if (prefix.length > typed.length) input.setValue(prefix);
        else say(`補完候補: ${matches.join('  ')}`);
      }
      screen.render();
    }

    function askCardPrompt(question) {
      lastBossEscapeAt = 0;
      return new Promise(resolve => {
        const modal = blessed.box({
          parent: screen, top: 'center', left: 'center', width: '80%', height: 7,
          border: { type: 'line' }, label: ' 名刺の編集 ',
          style: { border: { fg: 'yellow' }, fg: 'white', bg: 'black' }, tags: false
        });
        cardModal = modal;
        blessed.box({ parent: modal, top: 1, left: 1, width: '100%-4', height: 3, content: tuiText(question), style: { fg: 'white' } });
        const field = blessed.textbox({ parent: modal, bottom: 1, left: 1, width: '100%-4', height: 1, inputOnFocus: true, style: { fg: 'white', bg: 'blue' } });
        const finish = value => {
          if (cardModal !== modal) return;
          cardModal = null;
          cancelCardPrompt = null;
          modal.destroy();
          if (!closing) log.focus();
          screen.render();
          resolve(value);
        };
        cancelCardPrompt = () => finish(null);
        field.on('submit', value => finish(String(value ?? '')));
        field.on('cancel', () => finish(null));
        field.focus();
        screen.render();
      });
    }

    async function editCard() {
      if (cardEditing) return;
      lastBossEscapeAt = 0;
      cardEditing = true;
      try { await editCardInteractive(cardManager, askCardPrompt, say); }
      finally { cardEditing = false; if (!closing) { log.focus(); screen.render(); } }
    }

    function leaveBossMode() {
      if (!bossScreen) return;
      const activeScreen = bossScreen;
      bossScreen = null;
      activeScreen.close({ render: !closing });
    }

    function enterBossMode() {
      if (bossScreen?.active || closing) return;
      lastBossEscapeAt = 0;
      bossScreen = startBossScreen(screen, {
        variant: bossScreenVariant,
        onClose: () => { bossScreen = null; }
      });
    }

    /**
     * 参加者リストやステータス表示を更新・再描画します。
     */
    function draw() {
      if (!session) return;
      const ms = session.members();
      const sp = session.speaker;
      const sound = (session.room.bcast ? '📣 配信部屋 ' : '') + (!sp ? '🔇 音なし' : !sp.available ? '🔇 音が出せません' : sp.muted ? '🔇 消音中' : '🔈 音あり');
      const micState = !session.room.canTalk ? '' : session.micOn ? ' ─── 🎙 マイク オン' : ' ─── 🔇 マイク オフ（t で話す）';
      frame.setLabel(tuiText(` ${session.label()} ─── ${sound}${micState} `));
      const lines = [` 参加者（${ms.length}人）`];
      if (session.room.canTalk) {
        lines.push(session.micOn
          ? ` 🎙 マイク入力 ${formatMicMeter(session.micMeter?.() || {})}`
          : ' 🎙 マイク入力 OFF（t でオン）');
      }
      for (const m of ms) {
        const mark = (m.muted ? '🔇' : m.talking ? '🔊' : '') + (m.loud ? '🔉' : '');
        const role = m.owner ? '📣' : m.speaker ? '🎙' : '';   // 配信部屋：配信者・話してよい人
        lines.push('   ' + padWidth(tuiText(m.label), 30) + ' ' + mark + role);
      }
      members.setContent(lines.join('\n'));
      screen.render();
    }

    /**
     * 部屋から退出して画面を破棄します。
     * @param {string} [note] - 退出理由（満員など）
     */
    async function close(note) {
      if (closing) return; closing = true;
      lastBossEscapeAt = 0;
      leaveBossMode();
      unbindBossShortcut();
      cancelCardPrompt?.();
      clearInterval(ticker);
      keys.forEach(([k, fn]) => screen.unkey(k, fn));
      screen.removeListener('keypress', resetBossEscapeSequence);
      say('退出します…');
      await session?.leave();
      frame.destroy();
      screen.realloc();   // 部屋の画面の文字を残さないよう、全体を描き直す
      screen.render();
      resolve(note);
    }

    session = enterRoomImpl({
      target, profile, cardManager, lobby, sound, tts,
      onText: say,
      onChange: draw,
      onFull: cap => close(`満員でした（最大 ${cap}人）`),
      onCardEdit: editCard
    });
    // 話している印（🔊）は声の大きさで変わるので、出来事を待たずに描き直す
    const ticker = setInterval(draw, 400);

    // ── キー操作 ── 画面全体に付けて、退出時に外す（要素に付けると子にフォーカスがあるとき届かない）。
    // 入力欄や名刺編集の間は、1文字ショートカットを拾わない
    const typing = () => !!bossScreen?.active || cardEditing || screen.focused === input;
    let submittedAt = 0;   // 決定の Enter が、そのまま「入力欄を開く」にも届いてしまわないように
    const openInput = () => { if (typing() || Date.now() - submittedAt < 150) return; lastBossEscapeAt = 0; setHelp(true); input.focus(); screen.render(); };
    const bossOnDoubleEscape = () => {
      if (typing() || closing) { lastBossEscapeAt = 0; return; }
      const now = Date.now();
      if (lastBossEscapeAt && now - lastBossEscapeAt <= BOSS_ESCAPE_WINDOW_MS) {
        lastBossEscapeAt = 0;
        enterBossMode();
      } else {
        lastBossEscapeAt = now;
      }
    };
    const unbindBossShortcut = bindBossScreenShortcut(screen, {
      onOpen: enterBossMode,
      isEnabled: () => !typing() && !closing,
      isActive: () => !!bossScreen?.active
    });
    const keys = [
      ['escape', bossOnDoubleEscape],
      ['m', () => { if (!typing()) session.toggleMute(); }],
      ['t', () => { if (!typing()) session.toggleTalk(); }],
      ['q', () => { if (!typing()) close(); }],
      ['i', openInput],
      ['enter', openInput]
    ];
    keys.forEach(([k, fn]) => screen.key(k, fn));
    closeRoom = () => close();
    input.on('submit', value => {
      const s = String(value || '').trim();
      lastBossEscapeAt = 0;
      submittedAt = Date.now();
      input.clearValue(); setHelp(false); log.focus();
      if (s === '/q' || s === '/quit') return close();
      if (s.startsWith('/') && session.command(s)) { screen.render(); return; }
      if (s.startsWith('/')) say('（使えるのは /help /dice /tag /notag /list /who /card /hbk /unhbk /mic /mute /cp /copy /q です）');
      else if (s) session.say(s);
      screen.render();
    });
    input.on('cancel', () => { lastBossEscapeAt = 0; submittedAt = Date.now(); input.clearValue(); setHelp(false); log.focus(); screen.render(); });
    // 部屋の画面にいる間はキーがここに届くよう、log（frame の子）にフォーカスを置く
    log.focus();
    screen.realloc();
    draw();
  });
  return { done, close: () => closeRoom?.() };
}
