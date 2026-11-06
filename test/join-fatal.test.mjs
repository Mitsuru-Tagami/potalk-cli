// commands/join.mjs の致命エラー判定：接続上限の例外だけは全体を落とさない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPeerCapError } from '../commands/join.mjs';

test('isPeerCapError は polyfill の上限例外だけを拾う', () => {
  // lib/polyfill.mjs が MAX_LIVE_PC 到達時に投げる形（DOMException）
  assert.equal(isPeerCapError(new DOMException('too many peer connections', 'OperationError')), true);
  assert.equal(isPeerCapError(new Error('too many peer connections')), true);
  // 似た文言でも完全一致でなければ対象外（ほかのエラーは従来どおり致命扱い）
  assert.equal(isPeerCapError(new Error('too many peer connections!')), false);
  assert.equal(isPeerCapError(new Error('connection failed')), false);
  assert.equal(isPeerCapError(null), false);
  assert.equal(isPeerCapError(undefined), false);
});
