// 通話部屋に入る。本家（ブラウザ版）と同じデータチャネルの約束で話す。
// 約束の中身は本家 index.html の wireRoom / heartbeatPayload / leaveCall が原本。ここを変えたら向こうも見ること。
//
// CLI はマイクを持たないので、**無音の音声トラックを送る**（＝本家から見ると「ミュート中の人」）。
// 本家は部屋の全員から音が届く前提で、届かない相手には「送り直して」を頼み続け、相手が CLI だけだと
// 自動でつなぎ直しを繰り返してしまうため。配信部屋の聞き役は本家でも音を送らないので、送らない。
import { RTCAudioSource } from './polyfill.mjs';
import { joinRoom, selfId } from 'trystero/nostr';
import { TRYSTERO_BASE, HEARTBEAT_MS, ROOM_MAX, CHAT_MAX, CHAT_EVERY_MS, ROOM_CAP, BC_CAP, CAP_PROBE_MS, CAP_SETTLE_MS } from './config.mjs';
import { capText } from './text.mjs';
import { verifyRoster } from './roster.mjs';
import { newOathNonce, verifyOathResponse } from './oath.mjs';

// ── 部屋ID（本家と同じ形）：`ハッシュ` または配信部屋の `ハッシュ~pk~指紋` ──
const PK_SEP = '~pk~';
const FP_RE = /^[A-Za-z0-9_-]{22}$/;
const roomPk = id => { const s = String(id ?? ''), i = s.lastIndexOf(PK_SEP); const p = i < 0 ? '' : s.slice(i + PK_SEP.length); return FP_RE.test(p) ? p : ''; };
const roomBase = id => { const s = String(id ?? ''); return roomPk(s) ? s.slice(0, s.lastIndexOf(PK_SEP)) : s; };
export const isBcRoom = id => !!roomPk(id);
// 受け取った部屋IDの整形。切り詰めてよいのは名前（土台）の部分だけ（指紋が欠けると別の部屋になる）
export const capRoomId = v => { const base = capText(roomBase(v), ROOM_MAX), pk = roomPk(v); return pk ? base + PK_SEP + pk : base; };
export const newRoomId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64url');

// 招待リンク・部屋ID のどちらでも受け付ける。`https://…/#room=ID&name=名前`
export function parseRoomRef(ref) {
  const s = String(ref ?? '').trim();
  const hash = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s;
  if (hash.startsWith('room=')) {
    const q = new URLSearchParams(hash);
    return { roomId: capRoomId(q.get('room') || ''), name: capText(q.get('name') || '', ROOM_MAX) };
  }
  return { roomId: capRoomId(hash), name: '' };
}
// 部屋 ID そのものか（招待リンク・16 文字のハッシュ・配信部屋の ~pk~ 付き）。違えば「名前の一部」として探す
const HASH_RE = /^[A-Za-z0-9_-]{16}$/;
export function isRoomRef(ref) {
  const s = String(ref ?? '').trim();
  return s.includes('#room=') || s.startsWith('room=') || HASH_RE.test(s) || isBcRoom(s);
}
// 本家の公開先（po-talk.github.io はここへ転送される）
export const roomUrl = (roomId, name) => 'https://potalk.app/#room=' + roomId + (name ? '&name=' + encodeURIComponent(name) : '');

// 送る音。10ms ごとに 1 枚、マイクの音（話しているとき）か無音（ミュート中）を流し続ける。
// トラックはミュート中も止めない：本家は全員から音が届く前提で、届かない相手には「送り直して」を頼み続けるため
// （ブラウザもミュートは「無音を送る」で、トラックは生きている）。
const FRAME = 480;          // 10ms（48kHz）
const TALK_RMS = 600;       // これより大きければ「話している」
const TALK_WINDOW_MS = 4000;
function outgoingStream(mic) {
  const source = new RTCAudioSource();
  const track = source.createTrack();
  const silence = new Int16Array(FRAME);
  let muted = true, carry = 0, last = performance.now();
  // ロビーに出す「活発さ」（本家と同じ：直近 4 秒で話していた時間の割合を 0〜3 に）
  let spoke = 0, total = 0, talking = false;
  const timer = setInterval(() => {
    // 経過時間ぶんの枚数を送る（setInterval のずれが積もって声が速く／遅くならないように）
    const now = performance.now();
    carry += (now - last) / 10; last = now;
    for (; carry >= 1; carry--) {
      const samples = (!muted && mic?.take(FRAME)) || silence;
      source.onData({ samples, sampleRate: 48000, bitsPerSample: 16, channelCount: 1, numberOfFrames: FRAME });
      talking = !muted && samples !== silence && (mic?.level() || 0) > TALK_RMS;
      total += 10; if (talking) spoke += 10;
      if (total > TALK_WINDOW_MS) { spoke *= TALK_WINDOW_MS / total; total = TALK_WINDOW_MS; }
    }
  }, 10);
  return {
    stream: new MediaStream([track]),
    setMuted(on) { muted = !!on; },
    get talking() { return talking; },
    get talkLevel() { const r = total ? spoke / total : 0; return r > 0.25 ? 3 : r > 0.08 ? 2 : r > 0.01 ? 1 : 0; },
    stop: () => { clearInterval(timer); track.stop(); }
  };
}

const tooSoon = (map, key, ms) => { const now = Date.now(); if (now - (map.get(key) || 0) < ms) return true; map.set(key, now); return false; };
const sendTo = (act, data, target) => { try { act.send(data, target ? { target } : undefined).catch(() => {}); } catch {} };

/**
 * @param {object} o
 * @param {string} o.roomId   部屋ID
 * @param {string} o.name     部屋名（持って来た名前。空なら先にいる人の名前をもらう）
 * @param {{name:string, emoji:string}} o.profile
 * @param {object} o.lobby    openLobby() の戻り値（在室の告知に使う）
 * @param {(ev:object)=>void} o.onEvent  画面側への知らせ
 */
export function openRoom({ roomId, name = '', profile, lobby, mic = null, onEvent = () => {} }) {
  const bcast = isBcRoom(roomId);
  const cap = bcast ? BC_CAP : ROOM_CAP;
  const joinedAt = Date.now();
  const mySeconds = () => Math.floor((Date.now() - joinedAt) / 1000);
  const meta = { name: capText(name, ROOM_MAX), tag: '', tagBy: '', tagAt: 0 };
  const peers = new Set();
  const profiles = new Map();   // peerId -> { name, emoji, muted, joinedAt }
  const byeSeen = new Set();
  const seen = { profile: new Map(), chat: new Map(), nudge: new Map(), enter: new Map() };
  const audio = bcast ? null : outgoingStream(mic);   // 配信部屋の聞き役は音を送らない（本家と同じ）
  let micMuted = true;   // 入るときはミュート（スピーカーの音をマイクが拾って相手に返さないよう、話すときだけ開ける）
  let left = false, capTimer = null, enterSent = false, chatAt = 0;

  const room = joinRoom(TRYSTERO_BASE, roomId, {
    onJoinError: d => onEvent({ type: 'warn', text: String(d.error?.message || d.error || '').slice(0, 120) })
  });

  // ★ここから下の makeAction / onMessage は joinRoom の直後に同期で置く（最初の接続より前。後だと取りこぼす）
  const profileAction = room.makeAction('profile');
  const metaAction = room.makeAction('meta');
  const nudgeAction = room.makeAction('nudge');
  const byeAction = room.makeAction('bye');
  const chatAction = room.makeAction('chat');
  const bcAction = room.makeAction('bc');   // 配信部屋の名簿（署名つき）。ふつうの部屋では誰も送ってこない
  const oathAction = bcast ? room.makeAction('oath') : null;  // 配信者の本人確認（CLI は聞き役）

  // ── 配信部屋：誰の声を鳴らすかは、配信者が署名した名簿で決める（本家 acceptRoster / setSpeakers と同じ） ──
  // 受け取る側の既定は「名簿に載っていない人の声は鳴らさない」＝送る側の善意に頼らない。
  let speakers = new Set(), rosterSeen = 0, roster = null, ownerPeer = '';
  let ownerAuthed = '', ownerChallenge = null, ownerAuthAt = 0, ownerAuthSince = 0, ownerAuthWarned = false;
  const heldTracks = new Map();   // peerId -> いちばん新しい音声トラック（名簿で許可されたら、その場でつなぐ）
  const canHear = id => !bcast || (speakers.has(id) && (id !== ownerPeer || ownerAuthed === id));
  function challengeOwner(force = false) {
    if (!bcast || left || !ownerPeer || !peers.has(ownerPeer) || ownerAuthed === ownerPeer) return;
    const now = Date.now();
    if (!force && now - ownerAuthAt < 2500) return;
    const challenge = { peerId: ownerPeer, nonce: newOathNonce(), roomId, pk: roster?.pk, consumed: false };
    ownerChallenge = challenge;
    ownerAuthAt = now;
    if (!ownerAuthSince) ownerAuthSince = now;
    sendTo(oathAction, { k: 'q', n: challenge.nonce }, challenge.peerId);
  }
  const ownerAuthTimer = bcast ? setInterval(() => {
    if (!ownerPeer || !peers.has(ownerPeer) || ownerAuthed === ownerPeer) return;
    challengeOwner();
    if (ownerAuthSince && Date.now() - ownerAuthSince >= 10000 && !ownerAuthWarned) {
      ownerAuthWarned = true;
      onEvent({ type: 'system', text: '📣 配信者の本人確認ができません。配信者が古い CLI / アプリを使っている可能性があります。配信者の声は再生しません' });
    }
  }, 1000) : null;
  bcAction.onMessage = async d => {
    if (!bcast || left) return;
    const r = await verifyRoster(roomId, d, rosterSeen);
    if (!r || left || r.t <= rosterSeen) return;   // 検証の間に、より新しい名簿を採っていたら捨てる
    const ownerChanged = ownerPeer !== r.own;
    rosterSeen = r.t; roster = r.roster; ownerPeer = r.own;
    if (ownerChanged) {
      ownerAuthed = ''; ownerChallenge = null; ownerAuthAt = 0; ownerAuthSince = 0; ownerAuthWarned = false;
    }
    const was = speakers;
    speakers = new Set(r.ids);
    peers.forEach(id => {
      const now = speakers.has(id), before = was.has(id);
      const waitingForOwnerAuth = id === ownerPeer && ownerAuthed !== id;
      if (before && (!now || waitingForOwnerAuth)) onEvent({ type: 'gone', id });   // 外された／新しい配信者は認証まで黙らせる
      if (!before && now) {   // 許された＝持っているトラックをつなぐ。無ければ「送り直して」を頼む
        if (waitingForOwnerAuth) return;
        const t = heldTracks.get(id);
        if (t) onEvent({ type: 'track', id, track: t }); else sendTo(nudgeAction, 1, id);
      }
    });
    if (ownerChanged && r.own) challengeOwner(true);
    // 入室通知は「配信者が分かった＝部屋に届く」と分かってから 1 回だけ（本家と同じ順番）
    if (!enterSent && r.own) { enterSent = true; sendTo(chatAction, { sys: 'enter', q: false, n: profile.name }); }
    onEvent({ type: 'members' });
  };

  // CLI は配信部屋の聞き役として参加する。名簿で検証済みの公開鍵による応答が通るまで、
  // ownerPeer の音声は heldTracks にだけ置き、スピーカーへ渡さない。
  if (oathAction) oathAction.onMessage = async (d, { peerId }) => {
    if (left || !d || typeof d !== 'object' || d.k !== 'a') return;  // CLI は配信者鍵を持たないため q には応答しない
    const challenge = ownerChallenge;
    if (!challenge || challenge.consumed || peerId !== ownerPeer || peerId !== challenge.peerId || d.n !== challenge.nonce) return;
    if (!roster || roster.pk !== challenge.pk) return;
    challenge.consumed = true;  // 同じ nonce の応答を並行して検証しない
    const ok = await verifyOathResponse(challenge.roomId, challenge.nonce, d, challenge.pk);
    if (!ok || left || ownerChallenge !== challenge || ownerPeer !== peerId || !peers.has(peerId)) return;
    ownerAuthed = peerId;
    ownerChallenge = null;
    ownerAuthSince = 0;
    ownerAuthWarned = false;
    onEvent({ type: 'system', text: `📣 配信者：${who(peerId)}（本人確認済み）` });
    if (canHear(peerId)) {
      const track = heldTracks.get(peerId);
      if (track) onEvent({ type: 'track', id: peerId, track }); else sendTo(nudgeAction, 1, peerId);
    }
    onEvent({ type: 'members' });
  };

  // since＝部屋にいる秒数（満室のときの順位づけに使われる）。muted＝マイクを閉じているか（配信部屋の聞き役は常に）
  const myProfile = () => ({ name: profile.name, emoji: profile.emoji, muted: micMuted, stage: '🌱', relay: false, since: mySeconds(), bgm: 'off' });

  profileAction.onMessage = (d, { peerId }) => {
    const first = !profiles.has(peerId);
    const prev = profiles.get(peerId) || {};
    profiles.set(peerId, {
      name: capText(d?.name ?? prev.name, 20),
      emoji: capText(d?.emoji ?? prev.emoji, 8, '🙂'),
      muted: !!d?.muted,
      joinedAt: Number.isFinite(d?.since) && d.since >= 0 && d.since < 30 * 24 * 3600 ? Date.now() - d.since * 1000 : prev.joinedAt
    });
    // 「つながりました」は名前が分かってから出す（接続が張れた瞬間はまだプロフィールが来ていない）
    if (first) onEvent({ type: 'join', who: who(peerId) });
    if (first || !tooSoon(seen.profile, peerId, 400)) onEvent({ type: 'members' });
    scheduleCapacityCheck();
  };

  // 名前は先にいた人のもの（自分が名前を持っていないときだけもらう）、タグは tagAt が新しいほうが勝つ
  metaAction.onMessage = d => {
    if (!d || typeof d !== 'object') return;
    let changed = false;
    const n = capText(d.name, ROOM_MAX);
    if (n && !meta.name) { meta.name = n; changed = true; }
    const at = Math.min(Number(d.tagAt) || 0, Date.now() + 60000);
    if (at > meta.tagAt) { meta.tag = capText(d.tag, ROOM_MAX); meta.tagBy = capText(d.tagBy, 20); meta.tagAt = at; changed = true; }
    if (changed) { onEvent({ type: 'meta', meta: { ...meta } }); heartbeat(); }
  };

  // 「音が届いていないので送り直して」。こちらの無音トラックをその相手に入れ直す
  nudgeAction.onMessage = (_d, { peerId }) => {
    if (!audio || tooSoon(seen.nudge, peerId, 4000)) return;
    try { room.removeStream(audio.stream, { target: peerId }); } catch {}
    try { room.addStream(audio.stream, { target: peerId }); } catch {}
  };

  byeAction.onMessage = (_d, { peerId }) => byeSeen.add(peerId);

  chatAction.onMessage = (d, { peerId }) => {
    if (d && typeof d === 'object' && d.sys === 'enter') {   // 配信部屋の聞き役の入室通知
      if (!bcast || tooSoon(seen.enter, peerId, 30000)) return;
      onEvent({ type: 'system', text: d.q ? '誰かが静かに入室しました' : (capText(d.n, 20) || 'ゲスト') + ' さんが入室しました' });
      return;
    }
    const text = capText(d, CHAT_MAX);
    if (!text || tooSoon(seen.chat, peerId, 900)) return;
    onEvent({ type: 'chat', from: who(peerId), text });
  };

  if (audio) room.addStream(audio.stream);
  // 相手の音声トラックを画面側（スピーカー）へ渡す。トラック単位で受けるのは、相手が「送り直し」に応じたとき
  // 新しいトラックが届いても onPeerStream は二度と呼ばれないため（本家 __potTrack と同じ理由）。
  // 配信部屋では、名簿に載っていない人のトラックは手元に取っておくだけで鳴らさない（canHear）。
  const gotTrack = (id, track) => {
    if (!track || track.kind !== 'audio') return;
    heldTracks.set(id, track);
    if (canHear(id)) onEvent({ type: 'track', id, track });
  };
  room.onPeerTrack = (track, _stream, id) => gotTrack(id, track);
  room.onPeerStream = (stream, id) => gotTrack(id, stream.getAudioTracks?.()[0]);

  room.onPeerJoin = id => {
    peers.add(id);
    if (audio) room.addStream(audio.stream, { target: id });
    sendTo(profileAction, myProfile(), id);
    sendTo(metaAction, meta, id);
    if (bcast && roster) sendTo(bcAction, roster, id);   // 署名済みの名簿は誰が渡してもよい＝あとから来た人へ渡す
    if (bcast && id === ownerPeer) challengeOwner(true);
    scheduleCapacityCheck();
  };
  room.onPeerLeave = id => {
    const w = who(id), clean = byeSeen.has(id), known = profiles.has(id);
    peers.delete(id); profiles.delete(id); byeSeen.delete(id); heldTracks.delete(id);
    if (id === ownerPeer || id === ownerAuthed) {
      ownerAuthed = ''; ownerChallenge = null; ownerAuthAt = 0; ownerAuthSince = 0; ownerAuthWarned = false;
    }
    onEvent({ type: 'gone', id });
    if (known) onEvent({ type: 'leave', who: w, clean });   // 名乗る前に消えた相手は「つながった」も出していない
    onEvent({ type: 'members' });
  };

  // ── 定員：あとから入ってきた側だけが自分から抜ける（本家 checkCapacity と同じ判定） ──
  const olderThanMe = () => {
    let n = 0;
    peers.forEach(id => { const at = profiles.get(id)?.joinedAt; if (at === undefined || at < joinedAt || (at === joinedAt && id < selfId)) n++; });
    return n;
  };
  function scheduleCapacityCheck() {
    if (capTimer || left) return;
    capTimer = setTimeout(() => {
      capTimer = null;
      if (left || peers.size + 1 <= cap || Date.now() - joinedAt > CAP_PROBE_MS || olderThanMe() < cap) return;
      onEvent({ type: 'full', cap });
      leave();
    }, CAP_SETTLE_MS);
  }

  // ── ロビーへの在室（本家の決まり：部屋にいる人は必ず告知する＝秘密の部屋を作らせない） ──
  // 配信部屋の聞き役は名前・絵文字を載せない（本家と同じ。人数だけ数えられる）
  function heartbeat() {
    if (left) return;
    const p = { room: roomId, rn: meta.name, tag: meta.tag, tagBy: meta.tagBy, bo: false, muted: micMuted, elapsed: mySeconds(), talk: audio?.talkLevel || 0, tt: false };
    if (!bcast) Object.assign(p, { name: profile.name, emoji: profile.emoji, stage: '🌱' });
    lobby.announce(p);
  }
  heartbeat();
  const hbTimer = setInterval(heartbeat, HEARTBEAT_MS);

  function who(id) {
    const p = profiles.get(id);
    return p ? `${p.emoji}${p.name || 'ゲスト'}` : '（だれか）';
  }

  async function leave() {
    if (left) return;
    sendTo(byeAction, 1);           // 「退出します」を先に配る（来ないまま消えると相手には「切断」と出る）
    left = true;
    clearInterval(hbTimer); clearInterval(ownerAuthTimer); clearTimeout(capTimer);
    lobby.announce({ room: null });
    audio?.stop();
    await new Promise(r => setTimeout(r, 300));   // bye と在室の取り消しが出ていく時間
    await Promise.race([room.leave(), new Promise(r => setTimeout(r, 2000))]).catch(() => {});
  }

  return {
    roomId, bcast,
    meta: () => ({ ...meta }),
    // owner＝配信者（📣）、speaker＝配信部屋で話してよい人（🎙）
    members: () => [...peers].map(id => ({ id, label: who(id), muted: profiles.get(id)?.muted,
      owner: bcast && id === ownerPeer && ownerAuthed === id, speaker: bcast && speakers.has(id) && id !== ownerPeer })),
    // 話題タグを変える（Issue #15 の /tag）。本家の setTag と同じ：付けた人の名前と時刻を添えて全員へ送り、
    // ロビーにもすぐ出す。受け取る側は tagAt が新しいほうを採るので、誰でも上書きできる（履歴なし）。空なら消す
    setTag(text) {
      if (left) return;
      meta.tag = capText(String(text ?? '').trim(), ROOM_MAX);
      meta.tagBy = meta.tag ? profile.name : '';
      meta.tagAt = Date.now();
      sendTo(metaAction, meta);
      heartbeat();
      onEvent({ type: 'meta', meta: { ...meta } });
    },
    canTalk: !!audio,                       // 配信部屋の聞き役は話せない
    get micMuted() { return micMuted; },
    get talking() { return !!audio?.talking; },
    // マイクを開ける・閉じる。プロフィール（ミュートの印）を全員へ送り直し、ロビーにもすぐ出す（本家の #mute と同じ）
    setMicMuted(on) {
      if (!audio || left) return;
      micMuted = !!on;
      audio.setMuted(micMuted);
      sendTo(profileAction, myProfile());
      heartbeat();
    },
    // ひとことを全員へ送る。本家と同じく 60 文字まで・1.2 秒に 1 回まで。
    // 戻り値：{ ok, text（実際に送った文字）, cut（切り詰めたか）, wait（早すぎたとき、あと何ミリ秒か） }
    sendChat(raw) {
      const full = String(raw ?? '').trim();
      const text = capText(full, CHAT_MAX);
      if (!text || left) return { ok: false };
      const wait = CHAT_EVERY_MS - (Date.now() - chatAt);
      if (wait > 0) return { ok: false, wait };
      chatAt = Date.now();
      sendTo(chatAction, text);
      return { ok: true, text, cut: [...full].length > [...text].length };
    },
    leave
  };
}
