// マイクの音を取る。sox に付いている rec コマンドで、48kHz・モノラル・16bit の生の音を受け取り、
// 送る側（lib/room.mjs）が 10ms ずつ取り出せるように溜めておく。
// ミュート中は rec ごと止める（録音していない＝macOS のマイク使用中の表示も消える）。
import { spawn } from 'child_process';

const RATE = 48000;
const MAX_QUEUE = RATE * 0.2;   // 溜める上限（200ms）。超えたら古い分を捨てて、声が遅れていかないようにする

export function openMic({ onError = () => {} } = {}) {
  let rec = null, queue = [], queued = 0, level = 0, stopping = false;

  function start() {
    if (rec) return;
    stopping = false;
    queue = []; queued = 0;
    rec = spawn('rec', ['-q', '-t', 'raw', '-r', String(RATE), '-e', 'signed-integer', '-b', '16', '-c', '1', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', carry = null;
    rec.stderr.on('data', d => { stderr = (stderr + d).slice(-300); });
    rec.stdout.on('data', buf => {
      // 16bit の途中で切れて届くことがあるので、余った 1 バイトは次へ持ち越す
      if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
      if (buf.length % 2) { carry = buf.subarray(buf.length - 1); buf = buf.subarray(0, buf.length - 1); }
      const s = new Int16Array(buf.length / 2);
      for (let i = 0; i < s.length; i++) s[i] = buf.readInt16LE(i * 2);
      let sq = 0; for (const v of s) sq += v * v;
      level = s.length ? Math.sqrt(sq / s.length) : 0;
      queue.push(s); queued += s.length;
      while (queued > MAX_QUEUE && queue.length) queued -= queue.shift().length;
    });
    const proc = rec;
    proc.on('error', e => { if (rec === proc) rec = null; onError(e.code === 'ENOENT'
      ? 'マイクを使うには sox が必要です（brew install sox / apt install sox）'
      : 'マイクを開けませんでした: ' + e.message); });
    proc.on('exit', code => {
      if (rec === proc) rec = null;
      level = 0;
      if (stopping) return;
      const why = stderr.trim().split('\n').pop() || '';
      onError(`マイクが止まりました（${code}${why ? '：' + why : ''}）。`
        + (process.platform === 'darwin' ? 'macOS なら「システム設定 > プライバシーとセキュリティ > マイク」でターミナルを許可してください' : ''));
    });
  }

  function stop() {
    if (!rec) return;
    stopping = true;
    try { rec.kill(); } catch {}
    rec = null; queue = []; queued = 0; level = 0;
  }

  return {
    start, stop,
    get running() { return !!rec; },
    // n サンプル取り出す。足りなければ null（＝送る側は無音で埋める）
    take(n) {
      if (queued < n) return null;
      const out = new Int16Array(n);
      let i = 0;
      while (i < n) {
        const head = queue[0], k = Math.min(head.length, n - i);
        out.set(head.subarray(0, k), i);
        i += k; queued -= k;
        if (k === head.length) queue.shift(); else queue[0] = head.subarray(k);
      }
      return out;
    },
    level: () => level   // 直近の音の大きさ（RMS）
  };
}
