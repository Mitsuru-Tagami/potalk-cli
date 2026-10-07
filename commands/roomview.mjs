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

const MEMBERS_H = 10;   // 参加者の段の高さ（定員 8 人＋見出し＋余白）
const hhmm = () => new Date().toTimeString().slice(0, 5);

/**
 * 部屋に入って画面を出す。
 * @returns {{ done: Promise<string|undefined>, close: () => Promise<void> }}
 *   done は退出したら（q・満員）resolve する。close は外から退出させる（Ctrl-C で終了するとき）
 */
export function showRoom(screen, { target, profile, lobby, sound }) {
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
      ? '  Enter: ひとことを送る（60 文字まで） | Esc: やめる'
      : '  t: マイク オン/オフ | i / Enter: ひとこと | m: 音を消す・戻す | j/k: 遡る | q: 退出してロビーへ');
    setHelp(false);

    let session = null, closing = false;
    const say = text => { log.log(tuiText(`${hhmm()}  ${text}`)); screen.render(); };

    function draw() {
      if (!session) return;
      const ms = session.members();
      const sp = session.speaker;
      const sound = session.room.bcast ? '🔇 配信部屋（音はまだ）' : !sp ? '🔇 音なし' : !sp.available ? '🔇 音が出せません' : sp.muted ? '🔇 消音中' : '🔈 音あり';
      const micState = !session.room.canTalk ? '' : session.micOn ? ' ─── 🎙 マイク オン' : ' ─── 🔇 マイク オフ（t で話す）';
      frame.setLabel(tuiText(` ${session.label()} ─── ${sound}${micState} `));
      const lines = [` 参加者（${ms.length}人）`];
      for (const m of ms) {
        const mark = m.muted ? '🔇' : m.talking ? '🔊' : '';
        lines.push('   ' + padWidth(tuiText(m.label), 30) + ' ' + mark);
      }
      members.setContent(lines.join('\n'));
      screen.render();
    }

    async function close(note) {
      if (closing) return; closing = true;
      clearInterval(ticker);
      keys.forEach(([k, fn]) => screen.unkey(k, fn));
      say('退出します…');
      await session?.leave();
      frame.destroy();
      screen.realloc();   // 部屋の画面の文字を残さないよう、全体を描き直す
      screen.render();
      resolve(note);
    }

    session = enterRoom({
      target, profile, lobby, sound,
      onText: say,
      onChange: draw,
      onFull: cap => close(`満員でした（最大 ${cap}人）`)
    });
    // 話している印（🔊）は声の大きさで変わるので、出来事を待たずに描き直す
    const ticker = setInterval(draw, 400);

    // ── キー操作 ── 画面全体に付けて、退出時に外す（要素に付けると子にフォーカスがあるとき届かない）。
    // 入力欄にいる間は、1文字キー（m, q）を拾わない
    const typing = () => screen.focused === input;
    let submittedAt = 0;   // 決定の Enter が、そのまま「入力欄を開く」にも届いてしまわないように
    const openInput = () => { if (typing() || Date.now() - submittedAt < 150) return; setHelp(true); input.focus(); screen.render(); };
    const keys = [
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
      submittedAt = Date.now();
      input.clearValue(); setHelp(false); log.focus();
      if (s === '/q' || s === '/quit') return close();
      if (s === '/mute') return session.toggleMute();
      if (s === '/mic') return session.toggleTalk();
      if (s.startsWith('/')) say('（使えるのは /mic /mute /q です）');
      else if (s) session.say(s);
      screen.render();
    });
    input.on('cancel', () => { submittedAt = Date.now(); input.clearValue(); setHelp(false); log.focus(); screen.render(); });
    // 部屋の画面にいる間はキーがここに届くよう、log（frame の子）にフォーカスを置く
    log.focus();
    screen.realloc();
    draw();
  });
  return { done, close: () => closeRoom?.() };
}
