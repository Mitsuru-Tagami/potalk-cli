// ptk list / ptk 一覧 ── ロビーを一定時間眺めて、通話中の部屋を標準出力に書き出す
// （パイプや grep に流せるよう、TUI を使わない）
import { openLobby } from '../lib/lobby.mjs';

export async function runList({ seconds = 15 } = {}) {
  // Nostr リレーの 301 などで落ちないようにする
  process.on('uncaughtException', () => {});

  console.error(`🛰 ロビーに接続中…（${seconds}秒待って一覧を出します）`);
  const lobby = openLobby();
  await new Promise(r => setTimeout(r, seconds * 1000));

  const rooms = lobby.rooms();
  if (rooms.length === 0) {
    console.log('（現在通話中の部屋はありません）');
  } else {
    for (const r of rooms) {
      const tag = r.tag ? ` #${r.tag}` : '';
      const who = r.people.map(p => `${p.emoji}${p.name || '名無し'}${p.stage ? ` ${p.stage}` : ''}`).join(' ');
      console.log(`${r.bo ? '📡 ' : ''}${r.rn || '（名前のない部屋）'}${tag}  ${r.people.length}人  ${who}`);
    }
  }
  const { open, total } = lobby.relayStatus();
  console.error(`（リレー ${open}/${total}、ロビーの他の閲覧者 ${lobby.viewers()}）`);
  await lobby.leave();
  process.exit(0);
}
