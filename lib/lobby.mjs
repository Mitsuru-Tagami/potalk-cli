// ロビー（本家と同じ隠し部屋 __lobby__）に入り、通話中の部屋の presence を集める。
// 表示（TUI / 一覧出力）とは分離してある。
import './polyfill.mjs';
import { joinRoom, getRelaySockets } from 'trystero/nostr';
import { TRYSTERO_BASE, LOBBY_ROOM, STALE_MS } from './config.mjs';

// 本家の受信側と同じ上限で切り詰める（改造クライアント対策）
const cap = (v, n) => String(v ?? '').slice(0, n);

export function openLobby({ onChange = () => {}, onPeer = () => {} } = {}) {
  const presences = new Map();   // peerId -> { room, rn, tag, name, emoji, bo, ts }
  const room = joinRoom(TRYSTERO_BASE, LOBBY_ROOM);
  const presence = room.makeAction('presence');

  presence.onMessage = (d, { peerId }) => {
    if (!d || d.room == null) presences.delete(peerId);
    else presences.set(peerId, {
      room: cap(d.room, 64), rn: cap(d.rn, 30), tag: cap(d.tag, 30),
      name: cap(d.name, 20), emoji: cap(d.emoji || '🙂', 8), bo: !!d.bo,
      ts: Date.now()
    });
    onChange();
  };
  room.onPeerJoin = peerId => onPeer('join', peerId);
  room.onPeerLeave = peerId => { presences.delete(peerId); onPeer('leave', peerId); onChange(); };

  const sweep = setInterval(() => {
    const cut = Date.now() - STALE_MS;
    let changed = false;
    presences.forEach((v, k) => { if (v.ts < cut) { presences.delete(k); changed = true; } });
    if (changed) onChange();
  }, 5000);

  return {
    // 部屋ごとにまとめた一覧
    rooms() {
      const byRoom = new Map();
      presences.forEach(p => {
        const r = byRoom.get(p.room) || { id: p.room, rn: '', tag: '', bo: false, people: [] };
        r.people.push(p);
        r.rn ||= p.rn; r.tag ||= p.tag; r.bo ||= p.bo;
        byRoom.set(p.room, r);
      });
      return [...byRoom.values()];
    },
    viewers: () => Object.keys(room.getPeers()).length,
    // 自分の在室をロビーへ流す（部屋にいる間は 5 秒ごと・抜けたら { room: null }）
    announce: payload => presence.send(payload).catch(() => {}),
    // 開いているリレー数 / 設定したリレー数
    relayStatus() {
      const socks = Object.values(getRelaySockets?.() ?? {});
      return { open: socks.filter(ws => ws.readyState === 1).length, total: TRYSTERO_BASE.relayConfig.urls.length };
    },
    async leave() {
      clearInterval(sweep);
      await Promise.race([room.leave(), new Promise(r => setTimeout(r, 2000))]).catch(() => {});
    }
  };
}
