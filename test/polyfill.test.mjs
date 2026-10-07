// lib/polyfill.mjs の穴埋めが効いているか（ネットワークを使わず、同じプロセスの中で 2 本つなぐ）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerPoolPatched, livePeerConnections } from '../lib/polyfill.mjs';

test('trystero の作り置きの接続を減らす書き換えが効いている（trystero の版が変わると落ちる）', () => {
  assert.equal(offerPoolPatched, true);
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
