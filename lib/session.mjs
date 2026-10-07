// 部屋に入っている間のひとまとまり（部屋の接続＋スピーカー＋お知らせの文言）。
// 行表示（ptk join）と TUI（ロビーから Enter）の両方がこれを使う。画面の描き方だけが違う。
import { openRoom, roomUrl } from './room.mjs';
import { openSpeaker } from './audio.mjs';
import { openMic } from './mic.mjs';

// 部屋の出来事を、画面に出す1行の文にする（出さないものは null）
export function describeEvent(ev) {
  switch (ev.type) {
    case 'join': return `👋 ${ev.who} とつながりました`;
    case 'leave': return ev.clean ? `🚪 ${ev.who} が退出しました` : `🔌 ${ev.who} との接続が切れました（退出ではありません）`;
    case 'chat': return `💬 ${ev.from}：${ev.text}`;
    case 'system': return `ℹ️  ${ev.text}`;
    case 'meta': return `🏷  部屋名：${ev.meta.name || '（名前のない部屋）'}${ev.meta.tag ? `　話題：${ev.meta.tag}（${ev.meta.tagBy}）` : ''}`;
    case 'full': return `この部屋は満員です（最大 ${ev.cap}人）。しばらくしてから入り直してください`;
    case 'warn': return process.env.PTK_DEBUG ? `⚠️  ${ev.text}` : null;
    default: return null;
  }
}

/**
 * @param {object} o
 * @param {{roomId:string, name?:string}} o.target
 * @param {{name:string, emoji:string}} o.profile
 * @param {object} o.lobby          openLobby() の戻り値
 * @param {boolean} [o.sound=true]  声を鳴らすか
 * @param {(text:string)=>void} o.onText    お知らせ1行
 * @param {()=>void} [o.onChange]           参加者・部屋名などが変わった
 * @param {(cap:number)=>void} [o.onFull]   満員だった（自分から抜けた）
 */
export function enterRoom({ target, profile, lobby, sound = true, onText, onChange = () => {}, onFull = () => {} }) {
  const speaker = sound ? openSpeaker({ onError: msg => onText('🔇 ' + msg) }) : null;
  // マイクは「話す」に切り替えたときだけ開ける（それまで rec は起動しない）
  const mic = openMic({ onError: msg => { onText('🎙 ' + msg); session.setTalk(false, { quiet: true }); } });
  const room = openRoom({
    ...target, profile, lobby, mic,
    onEvent: ev => {
      if (ev.type === 'track') { speaker?.attach(ev.id, ev.track); return; }
      if (ev.type === 'gone') { speaker?.detach(ev.id); onChange(); return; }
      const text = describeEvent(ev);
      if (text) onText(text);
      if (ev.type === 'members' || ev.type === 'meta' || ev.type === 'join' || ev.type === 'leave') onChange();
      if (ev.type === 'full') onFull(ev.cap);
    }
  });

  const label = () => room.meta().name || '（名前のない部屋）';
  onText(`📞 ${label()} に入りました${room.bcast ? '（配信部屋・聞き役）' : ''}  あなた：${profile.emoji}${profile.name}`);
  onText(`🔗 ${roomUrl(room.roomId, target.name)}`);
  if (room.bcast) onText('🔇 配信部屋の音はまだ聞けません（ふつうの部屋だけ聞こえます）');
  else if (!speaker) onText('🔇 音なしで入りました（--no-sound）');
  if (room.canTalk) onText('🎙 マイクはオフで入りました。話すときはオンにしてください');
  onText('（相手とつながるまで数秒〜十数秒かかります）');

  let left = false, warnedEcho = false;
  const session = {
    room, speaker, label,
    // 自分を先頭にした参加者。talking は「いま声が出ている」
    members: () => [
      { label: `${profile.emoji}${profile.name}（あなた）`, muted: room.micMuted, talking: room.talking, self: true },
      ...room.members().map(m => ({ ...m, talking: !m.muted && !!speaker?.talking(m.id) }))
    ],
    // ひとことを送る。送ったものは自分には返ってこないので、自分のお知らせ欄にも出す
    say(text) {
      const r = room.sendChat(text);
      if (r.ok) onText(`💬 ${profile.emoji}${profile.name}（あなた）：${r.text}${r.cut ? '（長いので 60 文字で切りました）' : ''}`);
      else if (r.wait) onText(`（続けて送るには、あと ${Math.ceil(r.wait / 100) / 10} 秒待ってください）`);
      return r;
    },
    // 音を消す・戻す。結果をお知らせにも出す
    toggleMute() {
      if (!speaker?.available) { onText('🔇 音は出ていません'); return; }
      speaker.setMuted(!speaker.muted);
      onText(speaker.muted ? '🔇 音を消しました（もう一度で戻ります）' : '🔈 音を戻しました');
      onChange();
    },
    // マイクを開ける（話す）・閉じる（ミュート）
    setTalk(on, { quiet = false } = {}) {
      if (!room.canTalk) { if (!quiet) onText('🎙 配信部屋の聞き役は話せません'); return; }
      if (on) {
        mic.start();
        room.setMicMuted(false);
        if (!quiet) onText('🎙 マイクをオンにしました（もう一度でオフ）');
        if (!warnedEcho && !quiet) {
          warnedEcho = true;
          onText('🎧 スピーカーだと相手の声をマイクが拾って、相手に返ってしまいます。ヘッドホンを使ってください');
        }
      } else {
        room.setMicMuted(true);
        mic.stop();
        if (!quiet) onText('🔇 マイクをオフにしました');
      }
      onChange();
    },
    toggleTalk() { session.setTalk(room.micMuted); },
    get micOn() { return !room.micMuted; },
    async leave() {
      if (left) return; left = true;
      mic.stop();
      speaker?.close();
      await room.leave();
    }
  };
  return session;
}
