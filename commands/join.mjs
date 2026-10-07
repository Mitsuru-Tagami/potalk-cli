// ptk join / ptk create ── 通話部屋に入る（行表示。TUI ではロビーで部屋を選んで Enter）
// 今の版でできること：入る・参加者を見る・声を聞く・ひとことを読む／書く・出る。話すはまだ。
import readline from 'readline';
import { openLobby, matchRoom } from '../lib/lobby.mjs';
import { parseRoomRef, newRoomId, isRoomRef } from '../lib/room.mjs';
import { enterRoom } from '../lib/session.mjs';
import { capText } from '../lib/text.mjs';
import { ROOM_MAX } from '../lib/config.mjs';

const hhmm = () => new Date().toTimeString().slice(0, 5);
const say = s => console.log(`${hhmm()}  ${s}`);
const ask = (rl, q) => new Promise(r => rl.question(q, r));

const roomLine = (r, i) => `  ${i + 1}. ${r.bo ? '📡 ' : ''}${r.rn || '（名前のない部屋）'}${r.tag ? ' #' + r.tag : ''}  ${r.people.length}人 ${r.people.map(p => p.emoji).join('')}`;

// ロビーを眺めて部屋を集める。query があれば合うものだけ。
// 最長 15 秒。ただし合う部屋が見つかってから 4 秒ふえなければ、そこで打ち切る（いつも 15 秒待たせない）
async function scanLobby(lobby, query) {
  const hit = r => !query || matchRoom(r, query) || r.id === query;   // 古い部屋は ID＝名前なので ID の一致も見る
  const t0 = Date.now();
  let last = -1, stableSince = Date.now();
  while (Date.now() - t0 < 15000) {
    await new Promise(r => setTimeout(r, 500));
    const n = lobby.rooms().filter(hit).length;
    if (n !== last) { last = n; stableSince = Date.now(); }
    if (query && n > 0 && Date.now() - t0 > 5000 && Date.now() - stableSince > 4000) break;
  }
  return lobby.rooms().filter(hit);
}

// 候補から選ぶ。1 つならそのまま、複数なら番号で
async function pick(rooms, rl, query) {
  if (rooms.length === 1 && query) return rooms[0];
  rooms.forEach((r, i) => console.log(roomLine(r, i)));
  const n = Number(await ask(rl, '入る部屋の番号: '));
  return rooms[n - 1] || null;
}

// 引数なし：ロビー全体から番号で。引数が部屋 ID でなければ：名前の一部として探す（Issue #6）
async function pickFromLobby(lobby, rl, query = '') {
  console.error(query ? `🛰 「${query}」に合う部屋をロビーで探しています…（最長 15 秒）` : '🛰 ロビーを見ています…（15秒）');
  const rooms = await scanLobby(lobby, query);
  if (!rooms.length) {
    console.error(query
      ? `「${query}」に合う部屋は見つかりませんでした（部屋名・話題タグ・いる人の名前で探しています）。新しく作るなら ptk create ${query}`
      : '通話中の部屋がありません。ptk create 部屋名 で作れます。');
    return null;
  }
  const r = await pick(rooms, rl, query);
  return r ? { roomId: r.id, name: r.rn } : undefined;   // undefined＝番号が外れた（null＝見つからなかった）
}

export async function runJoin({ ref, create, profile, sound = true }) {
  process.on('uncaughtException', e => { if (process.env.PTK_DEBUG) console.error('[error]', e?.message || e); });
  // trystero はリレーの不調（rate limit など）を console.warn に出す。よくあることなので普段は隠す
  const warn = console.warn;
  console.warn = (...a) => { if (process.env.PTK_DEBUG || !String(a[0]).startsWith('Trystero:')) warn(...a); };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lobby = openLobby();

  let target;
  if (create) target = { roomId: newRoomId(), name: capText(create, ROOM_MAX) };
  else if (ref && isRoomRef(ref)) target = parseRoomRef(ref);
  else target = await pickFromLobby(lobby, rl, ref || '');
  // 見つからなかった理由は pickFromLobby が出している。番号の入力で外れたときだけここで言う
  if (!target?.roomId) { if (target !== null) console.error('部屋が決まりませんでした。'); await lobby.leave(); process.exit(1); }

  const session = enterRoom({
    target, profile, lobby, sound,
    onText: say,
    onFull: () => quit(1)
  });
  say('（文字を打って Enter でひとことを送る。/who 参加者　/mute 音を消す・戻す　/q 退出）');

  let quitting = false;
  async function quit(code = 0) {
    if (quitting) return; quitting = true;
    setTimeout(() => process.exit(code), 4000).unref();   // 何かで詰まっても必ず終わる
    say('退出します…');
    await session.leave();
    await lobby.leave();
    process.exit(code);
  }
  // ターミナルのウィンドウを閉じた（SIGHUP）・終了を頼まれた（SIGTERM）ときも、退出を知らせてから終わる。
  // 知らせずに消えると、ほかの人のロビーに部屋が十数秒〜30 秒残る（相手が気づくまで）
  for (const sig of ['SIGINT', 'SIGHUP', 'SIGTERM']) process.on(sig, () => quit(0));
  rl.on('SIGINT', () => quit(0));
  rl.on('close', () => quit(0));
  rl.on('line', line => {
    const s = line.trim();
    if (s === '/q' || s === '/quit') return quit(0);
    if (s === '/who') {
      const ms = session.members();
      say(`👥 ${ms.length}人：${ms.map(m => m.label + (m.self ? '' : m.muted ? '🔇' : m.talking ? '🔊' : '')).join(' ')}`);
      return;
    }
    if (s === '/mute') return session.toggleMute();
    if (s.startsWith('/')) { say('（使えるのは /who /mute /q です）'); return; }
    if (s) session.say(s);
  });
}
