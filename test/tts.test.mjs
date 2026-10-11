import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { createTts, parseTtsCommand } from '../lib/tts.mjs';

function fakeSpawnFactory() {
  const children = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    child.written = '';
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        child.written += chunk.toString();
        callback();
      }
    });
    child.kill = signal => { child.killedWith = signal; return true; };
    children.push({ child, command, args, options });
    return child;
  };
  return { children, spawnImpl };
}

test('TTSコマンドは引用符付き引数を保ってシェルなしで分解する', () => {
  assert.deepEqual(parseTtsCommand('espeak-ng -v ja'), ['espeak-ng', '-v', 'ja']);
  assert.deepEqual(parseTtsCommand('"/opt/my voice/say" --voice \'ja JP\''), ['/opt/my voice/say', '--voice', 'ja JP']);
  assert.deepEqual(parseTtsCommand('say \'\' \\&'), ['say', '', '&']);
  assert.equal(parseTtsCommand('say "unfinished'), null);
  assert.equal(parseTtsCommand('say trailing\\'), null);
  assert.equal(parseTtsCommand('  '), null);
});

test('受信本文だけを子プロセスのstdinへ渡し、出力をCLIから分離する', () => {
  const { children, spawnImpl } = fakeSpawnFactory();
  const tts = createTts('espeak-ng -v ja', { spawnImpl });

  assert.equal(tts.enabled, true);
  assert.equal(tts.speak('本文だけです。\nJSONではありません'), true);
  assert.equal(children.length, 1);
  assert.equal(children[0].child.written, '本文だけです。\nJSONではありません');
  assert.equal(children[0].command, 'espeak-ng');
  assert.deepEqual(children[0].args, ['-v', 'ja']);
  assert.deepEqual(children[0].options.stdio, ['pipe', 'ignore', 'ignore']);
  tts.close();
  assert.equal(children[0].child.killedWith, 'SIGTERM');
});

test('読み上げは順番に処理され、受信側は完了を待たない', async () => {
  const { children, spawnImpl } = fakeSpawnFactory();
  const tts = createTts('fake-tts', { spawnImpl });

  assert.equal(tts.speak('先の本文'), true);
  assert.equal(tts.speak('次の本文'), true);
  assert.equal(children.length, 1);
  assert.equal(children[0].child.written, '先の本文');

  children[0].child.emit('close', 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 2);
  assert.equal(children[1].child.written, '次の本文');
  tts.close();
});

test('コマンド起動失敗や不正な設定でCLI処理へ例外を漏らさない', () => {
  let attempts = 0;
  const { spawnImpl: workingSpawn } = fakeSpawnFactory();
  const tts = createTts('missing-then-ok', {
    spawnImpl(...args) {
      attempts += 1;
      if (attempts === 1) throw new Error('not found');
      return workingSpawn(...args);
    }
  });

  assert.doesNotThrow(() => tts.speak('失敗する起動'));
  assert.doesNotThrow(() => tts.speak('次の本文'));
  assert.equal(attempts, 2);
  tts.close();

  const invalid = createTts('broken "command', { spawnImpl: () => { throw new Error('must not run'); } });
  assert.equal(invalid.enabled, false);
  assert.equal(invalid.speak('本文'), false);
  invalid.close();
});

test('非同期の子プロセス起動エラーでも次の読み上げへ進む', async () => {
  const { children, spawnImpl } = fakeSpawnFactory();
  const tts = createTts('missing-tts', { spawnImpl });

  tts.speak('起動に失敗する項目');
  tts.speak('後続の本文');
  children[0].child.emit('error', new Error('ENOENT'));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(children.length, 2);
  assert.equal(children[1].child.written, '後続の本文');
  tts.close();
});
