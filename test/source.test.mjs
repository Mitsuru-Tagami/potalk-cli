// ソースに見えない文字（書字方向の上書き・ゼロ幅など）が実物のまま紛れていないか。
// 正規表現などでは \uXXXX のエスケープで書くこと（po-talk の index.html と同じ決まり）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u;

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'drafts.local'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(mjs|js|json|md)$/.test(e.name)) yield p;
  }
}

test('ソースに見えない文字が実物のまま入っていない', () => {
  const hits = [];
  for (const f of files(ROOT)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(INVISIBLE);
      if (m) hits.push(`${path.relative(ROOT, f)}:${i + 1} U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    });
  }
  assert.deepEqual(hits, []);
});
