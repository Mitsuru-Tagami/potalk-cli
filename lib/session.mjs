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
import { copyRoomUrl } from './clipboard.mjs';
import { createTts } from './tts.mjs';

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
    case 'card-empty': return `🪪 ${ev.who || '相手'}は名刺を登録していません`;
    case 'card-invalid': return `🛡 ${ev.who || '相手'}の名刺は形式が正しくないため表示できません`;
    case 'card': {
      const card = ev.card || {};
      const status = ev.keyVerified
        ? '接続相手の名刺鍵応答を確認済み（記載内容・SNS本人性は未検証）'
        : '未検証（名刺鍵の応答・記載内容・SNS本人性を未確認）';
      const lines = [`🪪 ${ev.who || '相手'} の名刺（${status}）`];
      if (card.bio) lines.push(`   ひとこと: ${card.bio}`);
      if (card.avatar) lines.push('   アイコン: 登録あり（CLIでは画像を表示しません）');
      const socials = {
        x: ['X', id => `https://x.com/${id}`],
        github: ['GitHub', id => `https://github.com/${id}`],
        note: ['note', id => `https://note.com/${id}`],
        instagram: ['Instagram', id => `https://www.instagram.com/${id}/`],
        youtube: ['YouTube', id => `https://www.youtube.com/${id.startsWith('@') ? '@' + encodeURIComponent(id.slice(1)) : 'channel/' + id}`],
        nostr: ['Nostr', id => `https://njump.me/${id}`]
      };
      for (const [service, id] of Object.entries(card.socials || {})) {
        const [label, makeUrl] = socials[service] || [];
        if (makeUrl) lines.push(`   ${label}: ${makeUrl(id)}（本人確認: 未検証）`);
      }
      if (Object.keys(card.pr || {}).length) lines.push('   SNS証拠: 受信済み（CLIでは照合していません）');
      if (card.tip) {
        const tipUrls = {
          ofuse: id => `https://ofuse.me/${id}`,
          amazon: id => `https://www.amazon.co.jp/hz/wishlist/ls/${id}`,
          zap: id => id.startsWith('npub1') ? `https://njump.me/${id}` : `lightning:${id}`,
          kofi: id => `https://ko-fi.com/${id}`,
          bmac: id => `https://buymeacoffee.com/${id}`
        };
        if (tipUrls[card.tip.p]) lines.push(`   お礼: ${tipUrls[card.tip.p](card.tip.id)}（本人の申告・未確認）`);
      }
      return lines.join('\n');
    }
    case 'full': return `この部屋は満員です（最大 ${ev.cap}人）。しばらくしてから入り直してください`;
    case 'warn': return process.env.PTK_DEBUG ? `⚠️  ${ev.text}` : null;
    default: return null;
  }
}

/** /hbk・/unhbk の番号指定を検証し、ローカル操作の結果だけを表示します。 */
export function handlePeerMuteCommand(command, argument, members, { mutePeer, unmutePeer, onText }) {
  if (!argument) {
    onText(`使用方法：${command} <参加者番号>（/who で番号を確認。自分は1番です）`);
    return true;
  }
  if (!/^\d+$/.test(argument)) {
    onText('参加者番号が正しくありません。/who で番号を確認してください（自分は1番です）。');
    return true;
  }
  const number = Number(argument);
  if (!Number.isSafeInteger(number) || number < 2 || number > members.length || !members[number - 1]?.id) {
    onText('参加者番号が正しくありません。/who で番号を確認してください（自分は1番です）。');
    return true;
  }
  const member = members[number - 1];
  const changed = command === '/hbk' ? mutePeer(member.id) : unmutePeer(member.id);
  if (command === '/hbk') {
    onText(changed ? `🔇 ${member.label} をローカルミュートしました（このセッションのみ）` : `🔇 ${member.label} はすでにローカルミュート中です`);
  } else {
    onText(changed ? `🔈 ${member.label} のローカルミュートを解除しました` : `🔈 ${member.label} はローカルミュートされていません`);
  }
  return true;
}

/** roomイベントを画面・TTS・JSONL callbackへ流し、ローカルミュートを境界で再確認します。 */
export function handleSessionRoomEvent(ev, { room, speaker, ttsPlayer, onText, onReceivedChat, onChange, onFull }) {
  if (ev.type === 'track') { speaker?.attach(ev.id, ev.track); return; }
  if (ev.type === 'gone') { speaker?.detach(ev.id); onChange(); return; }
  if (ev.type === 'peer-muted') { speaker?.detach(ev.id); onChange(); return; }
  if (ev.type === 'chat' && room?.isPeerMuted?.(ev.peerId)) return;

  const text = describeEvent(ev);
  if (text) onText(text);
  if (ev.type === 'chat') {
    ttsPlayer.speak(ev.text);
    onReceivedChat({ from: ev.from, text: ev.text });
  }
  if (ev.type === 'members' || ev.type === 'meta' || ev.type === 'join' || ev.type === 'leave') onChange();
  if (ev.type === 'full') onFull(ev.cap);
}

/**
 * 部屋に入室し、セッション（通話＋チャット機能）を開始します。
 * @param {object} o - セッション設定
 * @param {{roomId:string, name?:string}} o.target - 入室先の部屋情報
 * @param {{name:string, emoji:string}} o.profile - ユーザーのプロフィール
 * @param {object} o.lobby - ロビーオブジェクト（openLobby() の戻り値）
 * @param {boolean} [o.sound=true] - 音声を鳴らすかどうか（スピーカー有効化）
 * @param {typeof openRoom} [o.openRoomImpl=openRoom] - テスト用のRoom生成関数
 * @param {string|null} [o.tts] - 受信チャット本文を渡す外部TTSコマンド
 * @param {(text:string)=>void} o.onText - お知らせやチャットを1行テキストとして出力するコールバック
 * @param {(event:{from:string,text:string})=>void} [o.onReceivedChat] - 相手から受信したチャットだけを渡すコールバック
 * @param {()=>void} [o.onChange] - 参加者の増減や部屋のメタデータが変わった際にUIを更新するためのコールバック
 * @param {(cap:number)=>void} [o.onFull] - 満員で強制退出となった際のコールバック
 * @returns {object} - セッション操作（コマンド発行、チャット送信、ミュート切替、退出など）を行うオブジェクト
 */
export function enterRoom({ target, profile, cardManager = null, lobby, sound = true, tts = null, onText, onReceivedChat = () => {}, onChange = () => {}, onFull = () => {}, onCardEdit = null, openRoomImpl = openRoom }) {
  const speaker = sound ? openSpeaker({ onError: msg => onText('🔇 ' + msg) }) : null;
  const ttsPlayer = createTts(tts);
  
  // マイクは「話す」に切り替えたときだけ開ける（それまで rec は起動しない）
  const mic = openMic({ onError: msg => { onText('🎙 ' + msg); session.setTalk(false, { quiet: true }); } });
  
  let room;
  room = openRoomImpl({
    ...target, profile, cardManager, lobby, mic,
    onEvent: ev => handleSessionRoomEvent(ev, { room, speaker, ttsPlayer, onText, onReceivedChat, onChange, onFull })
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
      { label: `${profile.emoji}${profile.name} ${room.growthStage()}（あなた）`, stage: room.growthStage(), muted: room.micMuted, talking: room.talking, self: true },
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
          onText('   /who         : 現在の参加者一覧を表示する');
          onText('   /hbk <番号>  : 相手をこの端末だけでローカルミュートする');
          onText('   /unhbk <番号>: ローカルミュートを解除する');
          onText('   /mic         : マイクのON/OFFを切り替える');
          onText('   /mute        : スピーカーの音を消す・戻す');
          onText('   /cp, /copy   : 部屋のURLをクリップボードにコピーする');
          onText('   /card        : 自分の名刺を対話形式で編集する');
          onText('   /card <番号> : /who の参加者番号で相手の名刺を要求する（SNS本人性は未検証）');
          onText('   /q, /quit    : 部屋から退出する');
          return true;
        }
        case '/who': {
          const ms = session.members();
          onText(`👥 参加者 ${ms.length}人（名刺を受け取るには /card <番号>）\n${ms.map((m, i) => `   ${i + 1}. ${m.label}${m.muted ? '🔇' : m.talking ? '🔊' : ''}${m.owner ? '📣' : m.speaker ? '🎙' : ''}`).join('\n')}`);
          return true;
        }
        case '/card': {
          if (!arg) {
            if (onCardEdit) void Promise.resolve(onCardEdit()).catch(error => onText(`名刺の編集に失敗しました: ${error?.message || error}`));
            else onText('名刺編集の対話入力を利用できません。');
            return true;
          }
          const n = Number(arg);
          const members = session.members();
          if (!Number.isInteger(n) || n < 2 || n > members.length) {
            onText('参加者番号が正しくありません。/who で番号を確認してください（自分は1番です）。');
            return true;
          }
          const member = members[n - 1];
          if (!member?.id || !room.requestCard(member.id)) {
            onText('この相手には名刺を要求できません（配信部屋の名前のない聞き役を含みます）。');
            return true;
          }
          onText(`🪪 ${member.label} に名刺を要求しました。公開鍵があれば鍵の所持応答を確認し、記載内容・SNS本人性は未検証のまま表示します。`);
          return true;
        }
        case '/hbk':
        case '/unhbk':
          return handlePeerMuteCommand(cmd, arg, session.members(), {
            mutePeer: peerId => room.mutePeer(peerId),
            unmutePeer: peerId => room.unmutePeer(peerId),
            onText
          });
        case '/tag': {
          if (!arg) {
            const m = room.meta();
            onText(m.tag ? `🏷  いまの話題：${m.tag}（${m.tagBy}）　変えるには /tag 新しい話題、消すには /notag` : '🏷  話題はまだありません。/tag 話題 で付けられます');
          } else room.setTag(arg);
          return true;
        }
        case '/notag': room.setTag(''); return true;
        case '/list': {
          const me = { emoji: profile.emoji, name: profile.name, stage: room.growthStage() };
          const rooms = lobby.rooms().map(r => r.id === room.roomId ? { ...r, people: [me, ...r.people], here: true } : r);
          if (!rooms.some(r => r.here)) { const m = room.meta(); rooms.unshift({ id: room.roomId, rn: m.name, tag: m.tag, bo: false, people: [me], here: true }); }
          onText(`📋 通話中の部屋（${rooms.length}）`);
          for (const r of rooms) {
            onText(`   ${r.bo ? '📡 ' : ''}${r.rn || '（名前のない部屋）'}${r.tag ? ' #' + r.tag : ''}  ${r.people.length}人 ${r.people.map(p => `${p.emoji}${p.name || ''}${p.stage ? ` ${p.stage}` : ''}`).join(' ')}${r.here ? '  ← いまここ' : ''}`);
          }
          onText('   （移るには /q で出てから入り直してください）');
          return true;
        }
        case '/mic': session.toggleTalk(); return true;
        case '/mute': session.toggleMute(); return true;
        case '/cp':
        case '/copy': {
          const url = roomUrl(room.roomId, room.meta().name || target.name);
          void copyRoomUrl(url, { onText });
          return true;
        }
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
      ttsPlayer.close();
      await room.leave();
    }
  };
  return session;
}
