import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRYSTERO_BASE } from '../lib/config.mjs';

test('TRYSTERO relay list matches the current po-talk relay list', () => {
  // Keep this list synchronized with the canonical browser configuration.
  // https://github.com/po-talk/po-talk.github.io/blob/main/index.html
  assert.deepEqual(TRYSTERO_BASE.relayConfig.urls, [
    'wss://relay.primal.net',
    'wss://purplerelay.com',
    'wss://bucket.coracle.social',
    'wss://yabu.me/v2',
    'wss://x.kojira.io',
    'wss://relay.notoshi.win',
    'wss://relay.ditto.pub'
  ]);
});
