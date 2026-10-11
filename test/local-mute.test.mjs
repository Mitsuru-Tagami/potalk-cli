import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openRoom } from '../lib/room.mjs';
import { handlePeerMuteCommand, handleSessionRoomEvent } from '../lib/session.mjs';

function createFakeRoom() {
  const actions = new Map();
  const sent = [];
  const room = {
    makeAction(name) {
      const action = {
        onMessage: null,
        send(data, options) {
          sent.push({ name, data, options });
          return Promise.resolve();
        }
      };
      actions.set(name, action);
      return action;
    },
    addStream() {},
    removeStream() {},
    async leave() {}
  };
  return { room, actions, sent };
}

test('ローカルミュートはpeerId単位でchat/audioを抑え、解除時は最新trackを戻し、退出時に破棄する', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-local-mute-'));
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = configDir;
  const fake = createFakeRoom();
  const events = [];
  let room;
  try {
    room = openRoom({
      roomId: 'local-mute-test-room',
      profile: { name: '自分', emoji: '💻' },
      lobby: { announce() {} },
      joinRoomImpl: () => fake.room,
      outgoingStreamImpl: () => null,
      onEvent: event => events.push(event)
    });

    const firstPeer = 'connection-peer-1';
    const otherPeer = 'connection-peer-2';
    fake.room.onPeerJoin(firstPeer);
    fake.room.onPeerJoin(otherPeer);
    await fake.actions.get('profile').onMessage({ name: '同じ表示名', emoji: '🦊', muted: false, since: 1 }, { peerId: firstPeer });
    await fake.actions.get('profile').onMessage({ name: '同じ表示名', emoji: '🐱', muted: false, since: 2 }, { peerId: otherPeer });

    const firstTrack = { id: 'first-track', kind: 'audio' };
    const mutedTrack = { id: 'muted-track', kind: 'audio' };
    const newestTrack = { id: 'newest-track', kind: 'audio' };
    fake.room.onPeerTrack(firstTrack, null, firstPeer);
    assert.ok(events.some(event => event.type === 'track' && event.id === firstPeer && event.track === firstTrack));
    assert.ok(events.some(event => event.type === 'join' && event.who.includes('同じ表示名')));

    const outgoingBeforeMute = fake.sent.length;
    assert.equal(room.mutePeer(firstPeer), true);
    assert.equal(room.isPeerMuted(firstPeer), true);
    assert.equal(room.isPeerMuted(otherPeer), false);
    assert.equal(fake.sent.length, outgoingBeforeMute, 'ミュート状態は相手へ送信しない');
    assert.ok(events.some(event => event.type === 'peer-muted' && event.id === firstPeer), '現在の再生を切り離すイベントを出す');

    const eventsBeforeMutedInput = events.length;
    fake.actions.get('chat').onMessage('表示されないコメント', { peerId: firstPeer });
    fake.room.onPeerTrack(mutedTrack, null, firstPeer);
    assert.equal(events.slice(eventsBeforeMutedInput).some(event => event.type === 'chat' || event.type === 'track'), false);

    fake.actions.get('chat').onMessage('同名の別接続からのコメント', { peerId: otherPeer });
    assert.ok(events.some(event => event.type === 'chat' && event.peerId === otherPeer && event.text === '同名の別接続からのコメント'));
    assert.equal(events.some(event => event.type === 'chat' && event.peerId === firstPeer), false);

    fake.room.onPeerTrack(newestTrack, null, firstPeer);
    assert.equal(room.unmutePeer(firstPeer), true);
    assert.equal(room.isPeerMuted(firstPeer), false);
    assert.ok(events.some(event => event.type === 'track' && event.id === firstPeer && event.track === newestTrack), '解除時に保持していた最新trackを接続する');
    assert.equal(room.unmutePeer(firstPeer), false, '二重解除は状態を変えない');

    room.mutePeer(firstPeer);
    fake.room.onPeerLeave(firstPeer);
    assert.equal(room.isPeerMuted(firstPeer), false, '切断時にpeerIdのミュート状態を消す');
    assert.ok(events.some(event => event.type === 'leave' && event.who.includes('同じ表示名')), '切断通知はミュート中も残る');

    room.mutePeer(otherPeer);
    assert.equal(room.isPeerMuted(otherPeer), true);
    await room.leave();
    assert.equal(room.isPeerMuted(otherPeer), false, '退出時にセッション状態を全消去する');
  } finally {
    if (room) await room.leave();
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('/hbk・/unhbk は参加者番号をpeerIdに対応させ、自分・不正番号を拒否する', () => {
  const members = [
    { label: '自分', id: undefined },
    { label: '🦊同じ表示名', id: 'peer-id-one' },
    { label: '🐱同じ表示名', id: 'peer-id-two' }
  ];
  const operations = [];
  const messages = [];
  const controls = {
    mutePeer: id => { operations.push(['mute', id]); return true; },
    unmutePeer: id => { operations.push(['unmute', id]); return true; },
    onText: text => messages.push(text)
  };

  assert.equal(handlePeerMuteCommand('/hbk', '2', members, controls), true);
  assert.equal(handlePeerMuteCommand('/unhbk', '3', members, controls), true);
  assert.deepEqual(operations, [['mute', 'peer-id-one'], ['unmute', 'peer-id-two']]);
  assert.match(messages[0], /ローカルミュート/);
  assert.match(messages[1], /解除しました/);

  handlePeerMuteCommand('/hbk', '1', members, controls);
  handlePeerMuteCommand('/hbk', '2x', members, controls);
  handlePeerMuteCommand('/unhbk', '4', members, controls);
  handlePeerMuteCommand('/hbk', '', members, controls);
  assert.equal(operations.length, 2);
  assert.equal(messages.length, 6);
});

test('ローカルミュートchatは画面・TTS・JSONL callbackへ流さず、入退室通知は残す', () => {
  const text = [], spoken = [], jsonl = [], detached = [], changes = [];
  const room = { isPeerMuted: peerId => peerId === 'muted-peer' };
  const deps = {
    room,
    speaker: { attach() {}, detach: peerId => detached.push(peerId) },
    ttsPlayer: { speak: message => spoken.push(message) },
    onText: message => text.push(message),
    onReceivedChat: event => jsonl.push(event),
    onChange: () => changes.push(true),
    onFull() {}
  };

  handleSessionRoomEvent({ type: 'chat', peerId: 'muted-peer', from: '🦊相手', text: '非表示' }, deps);
  assert.deepEqual(text, []);
  assert.deepEqual(spoken, []);
  assert.deepEqual(jsonl, []);

  handleSessionRoomEvent({ type: 'chat', peerId: 'other-peer', from: '🐱別の人', text: '表示する' }, deps);
  assert.deepEqual(spoken, ['表示する']);
  assert.deepEqual(jsonl, [{ from: '🐱別の人', text: '表示する' }]);
  assert.ok(text.some(message => message.includes('表示する')));

  handleSessionRoomEvent({ type: 'peer-muted', id: 'muted-peer' }, deps);
  handleSessionRoomEvent({ type: 'leave', who: '🦊相手', clean: true }, deps);
  assert.deepEqual(detached, ['muted-peer']);
  assert.ok(text.some(message => message.includes('が退出しました')));
});
