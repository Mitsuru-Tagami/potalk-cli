import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeReceivedChat } from '../lib/events.mjs';

test('受信チャットを1行のJSONとして安全にシリアライズする', () => {
  const serialized = serializeReceivedChat({ from: '🦊あき', text: '一行目\n"二行目"' });
  assert.equal(serialized.includes('\n'), false);
  assert.deepEqual(JSON.parse(serialized), {
    type: 'chat',
    from: '🦊あき',
    text: '一行目\n"二行目"'
  });
});

test('受信チャットに表示名と本文の文字列を要求する', () => {
  assert.throws(() => serializeReceivedChat({ from: '相手' }), TypeError);
});
