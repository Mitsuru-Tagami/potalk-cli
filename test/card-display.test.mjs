import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeEvent } from '../lib/session.mjs';

test('鍵応答済みカードでもSNSと本文は未検証と表示し、本番URLを組み立てる', () => {
  const text = describeEvent({
    type: 'card', who: '相手', keyVerified: true,
    card: {
      bio: 'こんにちは',
      socials: { x: 'tagami_1', instagram: 'name.photo', youtube: '@日本語abc', nostr: 'npub1' + 'a'.repeat(58) },
      pr: { x: '12345678', github: 1 },
      tip: { p: 'amazon', id: 'ABCDEFGHIJ' }
    }
  });
  assert.match(text, /名刺鍵応答を確認済み/);
  assert.match(text, /記載内容・SNS本人性は未検証/);
  assert.match(text, /SNS証拠: 受信済み（CLIでは照合していません）/);
  assert.match(text, /本人確認: 未検証/);
  assert.match(text, /https:\/\/www\.instagram\.com\/name\.photo\//);
  assert.match(text, /https:\/\/www\.youtube\.com\/@%E6%97%A5%E6%9C%AC%E8%AA%9Eabc/);
  assert.match(text, /https:\/\/www\.amazon\.co\.jp\/hz\/wishlist\/ls\/ABCDEFGHIJ/);
  assert.doesNotMatch(text, /署名済み|本人確認済み/);
});

test('鍵がない・応答しない名刺は未検証のまま表示し、Zap npubは送金URIにしない', () => {
  const npub = 'npub1' + 'b'.repeat(58);
  const text = describeEvent({ type: 'card', who: '相手', keyVerified: false, card: { socials: { x: 'user_1' }, tip: { p: 'zap', id: npub } } });
  assert.match(text, /未検証（名刺鍵の応答・記載内容・SNS本人性を未確認）/);
  assert.match(text, /https:\/\/njump\.me\//);
  assert.doesNotMatch(text, /lightning:npub/);
});

test('不正形式のカード通知は本文署名失敗と誤認させない', () => {
  const text = describeEvent({ type: 'card-invalid', who: '相手' });
  assert.match(text, /形式が正しくない/);
  assert.doesNotMatch(text, /署名/);
});
