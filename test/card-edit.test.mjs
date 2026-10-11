import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCardManager } from '../lib/card.mjs';
import { editCardInteractive } from '../commands/card-edit.mjs';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-card-edit-test-')); process.env.XDG_CONFIG_HOME = dir; });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const responder = values => async () => values.shift() ?? '';

test('空Enterは値を維持し、削除記号は指定した項目だけを削除する', async () => {
  const manager = await loadCardManager();
  await manager.update({ bio: 'old bio', socials: { x: 'old_x', github: 'old-user' } });
  const before = manager.response();
  assert.equal(await editCardInteractive(manager, responder(['', '', '', '', '', '', ''])), true);
  assert.deepEqual(manager.response(), before);
  assert.equal(await editCardInteractive(manager, responder(['-', '-', '', '', '', '', ''])), true);
  const after = manager.response();
  assert.equal('bio' in after, false);
  assert.equal('x' in (after.socials || {}), false);
  assert.equal(after.socials.github, 'old-user');
});

test('不正SNS IDはエラー表示後に再質問し、正しい値だけを署名する', async () => {
  const manager = await loadCardManager();
  const messages = [];
  assert.equal(await editCardInteractive(manager, responder(['', 'bad/url', 'tagami_2', '', '', '', '', '']), message => messages.push(message)), true);
  assert.ok(messages.some(message => message.includes('入力形式が正しくありません')));
  assert.equal(manager.card.socials.x, 'tagami_2');
});
