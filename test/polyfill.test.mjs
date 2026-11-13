// lib/polyfill.mjs の穴埋めが効いているか（ネットワークを使わず、同じプロセスの中で 2 本つなぐ）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerPoolPatched, livePeerConnections, startLivePcLog, sweepStalePcs } from '../lib/polyfill.mjs';

test('trystero の作り置きの接続を減らす書き換えが効いている（trystero の版が変わると落ちる）', () => {
  assert.equal(offerPoolPatched, true);
});

test('startLivePcLog は PTK_DEBUG のときだけ生存中の接続数を定期的に出す', async () => {
  const saved = process.env.PTK_DEBUG;
  const lines = [];
  const log = s => lines.push(s);
  try {
    delete process.env.PTK_DEBUG;
    const stopOff = startLivePcLog({ intervalMs: 10, log });
    await new Promise(r => setTimeout(r, 35));
    stopOff();
    assert.deepEqual(lines, []);   // PTK_DEBUG なしでは何も出ない

    process.env.PTK_DEBUG = '1';
    const before = livePeerConnections();
    const stop = startLivePcLog({ intervalMs: 10, log });
    await new Promise(r => setTimeout(r, 35));
    stop();
    assert.ok(lines.length >= 2);
    assert.ok(lines.every(s => s === `[pc] live=${before}`));
  } finally {
    if (saved === undefined) delete process.env.PTK_DEBUG; else process.env.PTK_DEBUG = saved;
  }
});

test('引数なしの setLocalDescription と、順番待ち（operations chain）でつながる', async () => {
  const before = livePeerConnections();
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  assert.equal(livePeerConnections(), before + 2);
  a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate);
  const ch = a.createDataChannel('t');
  const got = new Promise(res => { b.ondatachannel = e => { e.channel.onmessage = m => res(m.data); }; });
  ch.onopen = () => ch.send('こんにちは');

  await a.setLocalDescription();                 // 引数なし＝offer（wrtc 単体では「Expected an object」で落ちる）
  // 待たずに続けて呼んでも、順番に処理される（ブラウザと同じ）
  const remote = b.setRemoteDescription(a.localDescription);
  const local = b.setLocalDescription();         // ＝answer
  await Promise.all([remote, local]);
  assert.equal(b.localDescription.type, 'answer');
  await a.setRemoteDescription(b.localDescription);

  assert.equal(await got, 'こんにちは');
  a.close(); b.close();
  assert.equal(livePeerConnections(), before);
});

test('掃除屋は、状態の止まった未接続の接続だけを閉じ、新しい接続には触らない', () => {
  const before = livePeerConnections();
  const stale = new RTCPeerConnection();
  assert.equal(livePeerConnections(), before + 1);
  const silent = () => {};
  // 作られたばかり（時刻を進めていない）なら閉じない
  assert.equal(sweepStalePcs({ log: silent }), 0);
  assert.equal(livePeerConnections(), before + 1);
  // 11分進めた世界では、確立も遷移もなかったこの接続は滞留として閉じる
  assert.equal(sweepStalePcs({ now: Date.now() + 11 * 60 * 1000, log: silent }), 1);
  assert.equal(stale.connectionState, 'closed');
  assert.equal(livePeerConnections(), before);
});

test('掃除屋は、つながっている接続には時刻を進めても触らない', async () => {
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate);
  const ch = a.createDataChannel('t');
  const opened = new Promise(res => { ch.onopen = res; });
  await a.setLocalDescription();
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription();
  await a.setRemoteDescription(b.localDescription);
  await opened;
  const before = livePeerConnections();
  assert.equal(sweepStalePcs({ now: Date.now() + 60 * 60 * 1000, log: () => {} }), 0);
  assert.equal(livePeerConnections(), before);
  assert.notEqual(a.connectionState, 'closed');
  assert.notEqual(b.connectionState, 'closed');
  // wrtc は、つながった直後の接続を閉じると後始末が競合してプロセス終了時に
  // segfault することがある（実測で再現）。少し落ち着かせてから閉じる。
  await new Promise(r => setTimeout(r, 300));
  a.close(); b.close();
});

test('閉じた接続の localDescription は null を返し、ネイティブ側を読まない', async () => {
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate);
  a.createDataChannel('t');
  await a.setLocalDescription();
  assert.equal(a.localDescription.type, 'offer');   // 開いている間は通常どおり読める
  a.close(); b.close();
  assert.equal(a.localDescription, null);
  assert.equal(b.localDescription, null);
});

test('localDescription は写しから返り、ICE収集の完了で候補入りのSDPに更新される', async () => {
  const a = new RTCPeerConnection();
  a.createDataChannel('t');
  await a.setLocalDescription();
  const first = a.localDescription;
  assert.equal(first.type, 'offer');
  assert.equal(typeof first.sdp, 'string');
  // 返した写しを書き換えても、次の読み取りには影響しない
  first.sdp = 'corrupted';
  assert.notEqual(a.localDescription.sdp, 'corrupted');
  // ICE 収集が終わると、候補（a=candidate）入りの SDP が写しに反映される
  const deadline = Date.now() + 5000;
  while (!a.localDescription.sdp.includes('a=candidate') && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 25));
  }
  assert.match(a.localDescription.sdp, /a=candidate/);
  a.close();
  assert.equal(a.localDescription, null);
});

test('rollback の後は localDescription の写しも null になる', async () => {
  const a = new RTCPeerConnection();
  a.createDataChannel('t');
  await a.setLocalDescription();
  assert.equal(a.localDescription.type, 'offer');
  await a.setLocalDescription({ type: 'rollback' });
  assert.equal(a.localDescription, null);
  a.close();
});

test('閉じた接続の remoteDescription 系も null を返し、ネイティブ側を読まない', async () => {
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
  b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
  a.createDataChannel('t');
  await a.setLocalDescription();
  await b.setRemoteDescription(a.localDescription);
  // 開いている間は通常どおり読める（trystero の candidate 振り分けが使う）
  assert.equal(b.remoteDescription.type, 'offer');
  assert.match(b.remoteDescription.sdp, /a=ice-ufrag:/);
  b.close(); a.close();
  // 閉じた後は、遅れて届いた candidate の処理が読んでも落ちずに null が返る
  assert.equal(b.remoteDescription, null);
  assert.equal(b.currentRemoteDescription, null);
  assert.equal(b.pendingRemoteDescription, null);
  assert.equal(b.currentLocalDescription, null);
  assert.equal(b.pendingLocalDescription, null);
});
