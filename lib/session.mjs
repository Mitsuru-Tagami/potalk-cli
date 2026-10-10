/**
 * @fileoverview 部屋（Room）に入っている間のセッション状態を管理するモジュール。
 * WebRTCの接続（room.mjs）、スピーカー（audio.mjs）、マイク（mic.mjs）を統合し、
 * TUIやCLI行表示など、画面の描き方に依存しないコアのチャットコマンドやイベント処理を提供します。
 * 
 * 【今後の拡張ポイント】
 * - 複数デバイスからの同一ユーザーの入室を管理する機能
 * - メッセージ履歴のローカル保存（ファイルやDBへのエクスポート）
 * - メンション機能や、特定のユーザーを対象としたプライベートなシグナリング
 */

import { openRoom, roomUrl } from './room.mjs';
import { openSpeaker } from './audio.mjs';
import { openMic } from './mic.mjs';

/**
 * 部屋の出来事（イベント）を、画面に出力する1行のフォーマット済み文字列に変換します。
 * 出力しないイベントの場合はnullを返します。
 * @param {object} ev - room.mjsから送られてくるイベントオブジェクト
 * @returns {string|null} - 画面表示用テキスト
 */
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
 * 部屋に入室し、セッション（通話＋チャット機能）を開始します。
 * @param {object} o - セッション設定
 * @param {{roomId:string, name?:string}} o.target - 入室先の部屋情報
 * @param {{name:string, emoji:string}} o.profile - ユーザーのプロフィール
 * @param {object} o.lobby - ロビーオブジェクト（openLobby() の戻り値）
 * @param {boolean} [o.sound=true] - 音声を鳴らすかどうか（スピーカー有効化）
 * @param {(text:string)=>void} o.onText - お知らせやチャットを1行テキストとして出力するコールバック
 * @param {()=>void} [o.onChange] - 参加者の増減や部屋のメタデータが変わった際にUIを更新するためのコールバック
 * @param {(cap:number)=>void} [o.onFull] - 満員で強制退出となった際のコールバック
 * @returns {object} - セッション操作（コマンド発行、チャット送信、ミュート切替、退出など）を行うオブジェクト
 */
export function enterRoom({ target, profile, lobby, sound = true, onText, onChange = () => {}, onFull = () => {} }) {
  const speaker = sound ? openSpeaker({ onError: msg => onText('🔇 ' + msg) }) : null;
  
  // マイクは「話す」に切り替えたときだけ開ける（それまで rec は起動しない）
  const mic = openMic({ onError: msg => { onText('🎙 ' + msg); session.setTalk(false, { quiet: true }); } });
  
  const room = openRoom({
    ...target, profile, lobby, mic,
    onEvent: ev => {
      // 相手からの音声トラックを受信してスピーカーに接続・切断
      if (ev.type === 'track') { speaker?.attach(ev.id, ev.track); return; }
      if (ev.type === 'gone') { speaker?.detach(ev.id); onChange(); return; }
      
      const text = describeEvent(ev);
      if (text) onText(text);
      if (ev.type === 'members' || ev.type === 'meta' || ev.type === 'join' || ev.type === 'leave') onChange();
      if (ev.type === 'full') onFull(ev.cap);
    }
  });

  const label = () => room.meta().name || '（名前のない部屋）';
  
  // 初期入室時の案内メッセージ
  onText(`📞 ${label()} に入りました${room.bcast ? '（配信部屋・聞き役）' : ''}  あなた：${profile.emoji}${profile.name}`);
  onText(`🔗 ${roomUrl(room.roomId, target.name)}`);
  if (room.bcast) onText('📣 配信部屋です。配信者と、配信者が許可した人の声だけが聞こえます（配信者の名簿が届くまで数秒かかります）');
  if (!speaker) onText('🔇 音なしで入りました（--no-sound）');
  if (room.canTalk) onText('🎙 マイクはオフで入りました。話すときはオンにしてください');
  onText('（相手とつながるまで数秒〜十数秒かかります。 /help でコマンド一覧を表示します）');

  let left = false, warnedEcho = false;
  
  const session = {
    room, speaker, label,
    /**
     * 参加者リストを取得します。自分自身を先頭に配置します。
     * talkingフラグは「いま声が出ている」状態を表します。
     * @returns {Array<object>}
     */
    members: () => [
      { label: `${profile.emoji}${profile.name}（あなた）`, muted: room.micMuted, talking: room.talking, self: true },
      ...room.members().map(m => ({ ...m, talking: !m.muted && !!speaker?.talking(m.id) }))
    ],
    
    /**
     * テキストチャットを部屋の全員に送信します。
     * 自分の発言は自分には返ってこないため、送信成功時に自らの画面に表示します。
     * @param {string} text - 送信するメッセージ
     * @returns {object} - 送信結果 (ok, text, cut, wait)
     */
    say(text) {
      const r = room.sendChat(text);
      if (r.ok) onText(`💬 ${profile.emoji}${profile.name}（あなた）：${r.text}${r.cut ? '（長いので 60 文字で切りました）' : ''}`);
      else if (r.wait) onText(`（続けて送るには、あと ${Math.ceil(r.wait / 100) / 10} 秒待ってください）`);
      return r;
    },
    
    /**
     * スピーカー（受話）の音のON/OFFを切り替えます。
     */
    toggleMute() {
      if (!speaker?.available) { onText('🔇 音は出ていません'); return; }
      speaker.setMuted(!speaker.muted);
      onText(speaker.muted ? '🔇 音を消しました（もう一度で戻ります）' : '🔈 音を戻しました');
      onChange();
    },
    
    /**
     * ユーザーが入力した「/」から始まるチャットコマンドを処理します。
     * 行表示・TUI 共通のロジックです。
     * @param {string} line - 入力行
     * @returns {boolean} - コマンドとして処理された場合はtrue
     */
    command(line) {
      const cmd = line.trim().split(/\s+/)[0];
      const arg = line.trim().slice(cmd.length).trim();
      switch (cmd) {
        case '/help': {
          onText('💡 【利用可能なチャットコマンド一覧】');
          onText('   /help        : このコマンド一覧を表示する');
          onText('   /tag <話題>  : 部屋の話題を変更する (引数なしで現在の話題を確認)');
          onText('   /notag       : 部屋の話題を削除する');
          onText('   /list        : 現在の部屋にいながら、ほかの通話中の部屋一覧を見る');
          onText('   /who         : 現在の参加者一覧を表示する（行表示モード時）');
          onText('   /mic         : マイクのON/OFFを切り替える');
          onText('   /mute        : スピーカーの音を消す・戻す');
          onText('   /q, /quit    : 部屋から退出する');
          return true;
        }
        case '/tag': {
          if (!arg) {
            const m = room.meta();
            onText(m.tag ? `🏷  いまの話題：${m.tag}（${m.tagBy}）　変えるには /tag 新しい話題、消すには /notag` : '🏷  話題はまだありません。/tag 話題 で付けられます');
          } else room.setTag(arg);
          return true;
        }
        case '/notag': room.setTag(''); return true;
        case '/list': {
          const me = { emoji: profile.emoji, name: profile.name };
          const rooms = lobby.rooms().map(r => r.id === room.roomId ? { ...r, people: [me, ...r.people], here: true } : r);
          if (!rooms.some(r => r.here)) { const m = room.meta(); rooms.unshift({ id: room.roomId, rn: m.name, tag: m.tag, bo: false, people: [me], here: true }); }
          onText(`📋 通話中の部屋（${rooms.length}）`);
          for (const r of rooms) {
            onText(`   ${r.bo ? '📡 ' : ''}${r.rn || '（名前のない部屋）'}${r.tag ? ' #' + r.tag : ''}  ${r.people.length}人 ${r.people.map(p => p.emoji).join('')}${r.here ? '  ← いまここ' : ''}`);
          }
          onText('   （移るには /q で出てから入り直してください）');
          return true;
        }
        case '/mic': session.toggleTalk(); return true;
        case '/mute': session.toggleMute(); return true;
        default: return false;
      }
    },
    
    /**
     * マイクのON/OFF（ミュート状態）を直接指定します。
     * @param {boolean} on - ONにする場合はtrue
     * @param {object} opts - オプション (quiet: trueでシステムメッセージを抑制)
     */
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
    
    /**
     * マイクのON/OFF状態を反転させます。
     */
    toggleTalk() { session.setTalk(room.micMuted); },
    get micOn() { return !room.micMuted; },
    
    /**
     * 部屋から退出します。関連するメディアリソースの解放も行います。
     */
    async leave() {
      if (left) return; left = true;
      mic.stop();
      speaker?.close();
      await room.leave();
    }
  };
  return session;
}
