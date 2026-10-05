// ptk join / ptk create ── 通話部屋に入る（行表示。TUI ではロビーで部屋を選んで Enter）
// 今の版でできること：入る・参加者を見る・声を聞く・ひとことを読む／書く・出る。話すはまだ。
import readline from 'readline';
import { openLobby } from '../lib/lobby.mjs';
import { parseRoomRef, newRoomId } from '../lib/room.mjs';
import { enterRoom } from '../lib/session.mjs';
import { capText } from '../lib/text.mjs';
import { ROOM_MAX } from '../lib/config.mjs';

const hhmm = () => new Date().toTimeString().slice(0, 5);
const say = s => console.log(`${hhmm()}  ${s}`);
const ask = (rl, q) => new Promise(r => rl.question(q, r));

// 引数なし：ロビーを少し眺めて番号で選ばせる
async function pickFromLobby(lobby, rl) {
  console.error('🛰 ロビーを見ています…（15秒）');
  await new Promise(r => setTimeout(r, 15000));
  const rooms = lobby.rooms();
  if (!rooms.length) { console.error('通話中の部屋がありません。ptk create 部屋名 で作れます。'); return null; }
  rooms.forEach((r, i) => console.log(`  ${i + 1}. ${r.bo ? '📡 ' : ''}${r.rn || '（名前のない部屋）'}${r.tag ? ' #' + r.tag : ''}  ${r.people.length}人 ${r.people.map(p => p.emoji).join('')}`));
  const n = Number(await ask(rl, '入る部屋の番号: '));
  const r = rooms[n - 1];
  return r ? { roomId: r.id, name: r.rn } : null;
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
  else if (ref) target = parseRoomRef(ref);
  else target = await pickFromLobby(lobby, rl);
  if (!target?.roomId) { console.error('部屋が決まりませんでした。'); await lobby.leave(); process.exit(1); }

  const session = enterRoom({
    target, profile, lobby, sound,
    onText: say,
    onFull: () => quit(1)
  });
  say('（文字を打って Enter でひとことを送る。/who 参加者　/mute 音を消す・戻す　/q 退出）');

  let quitting = false;
  async function quit(code = 0) {
    if (quitting) return; quitting = true;
    say('退出します…');
    await session.leave();
    await lobby.leave();
    process.exit(code);
  }
  process.on('SIGINT', () => quit(0));
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
