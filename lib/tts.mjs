import { spawn } from 'node:child_process';

/**
 * コマンド文字列を、シェルを介さず spawn に渡せる実行ファイルと引数へ分解します。
 * 空白区切りとシングル／ダブルクォート、バックスラッシュによる引用を扱います。
 * シェル展開・パイプ・リダイレクトは実行しません。
 * @param {string|null|undefined} command
 * @returns {string[]|null} 無効または未指定なら null
 */
export function parseTtsCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return null;

  const parts = [];
  let part = '';
  let quote = null;
  let escaped = false;
  let started = false;

  for (const char of command.trim()) {
    if (escaped) {
      part += char;
      escaped = false;
      started = true;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else part += char;
      started = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started) {
        parts.push(part);
        part = '';
        started = false;
      }
    } else {
      part += char;
      started = true;
    }
  }

  if (escaped || quote) return null;
  if (started) parts.push(part);
  return parts.length ? parts : null;
}

/**
 * 受信チャットをBYOE TTSコマンドへ順番に流します。
 * 子プロセスの標準出力・標準エラーはCLIの表示やJSONLを汚さないよう破棄し、
 * 起動／実行エラーは読み上げを諦めるだけでCLI側へ伝播させません。
 * @param {string|null|undefined} command
 * @param {{spawnImpl?: Function, maxQueue?: number}} [options] テスト用のspawn差し替えも可能
 */
export function createTts(command, { spawnImpl = spawn, maxQueue = 32 } = {}) {
  const parsed = parseTtsCommand(command);
  const queue = [];
  let active = null;
  let closed = false;

  function runNext() {
    if (closed || active || !queue.length || !parsed) return;

    const text = queue.shift();
    let child;
    try {
      child = spawnImpl(parsed[0], parsed.slice(1), {
        stdio: ['pipe', 'ignore', 'ignore']
      });
    } catch {
      // 実行ファイルが無効などの同期エラーも、CLIのメイン処理には返さない。
      runNext();
      return;
    }

    active = child;
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      if (active === child) active = null;
      runNext();
    };

    child.once('error', complete);
    child.once('close', complete);
    // TTSコマンドが先に終了した際の EPIPE などを未処理例外にしない。
    child.stdin?.on('error', () => {});
    try {
      if (!child.stdin || typeof child.stdin.end !== 'function') {
        complete();
        try { child.kill?.(); } catch {}
        return;
      }
      child.stdin.end(text);
    } catch {
      complete();
      try { child.kill?.(); } catch {}
    }
  }

  return {
    enabled: !!parsed,
    /**
     * 読み上げをキューへ登録します。実処理は子プロセスで非同期に行われます。
     * キュー上限を超えた場合は新しい項目を捨て、CLIを遅延させません。
     * @param {string} text
     * @returns {boolean} キューに登録できたか
     */
    speak(text) {
      const limit = Number.isFinite(maxQueue) ? Math.max(0, Math.floor(maxQueue)) : 32;
      if (!parsed || closed || typeof text !== 'string' || !text.length || queue.length >= limit) return false;
      queue.push(text);
      runNext();
      return true;
    },
    /** セッション終了時に待機中の読み上げを破棄し、実行中の子プロセスを止めます。 */
    close() {
      if (closed) return;
      closed = true;
      queue.length = 0;
      const child = active;
      active = null;
      try { child?.kill?.('SIGTERM'); } catch {}
    }
  };
}
