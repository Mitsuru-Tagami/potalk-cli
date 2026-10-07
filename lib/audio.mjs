// 相手の声を鳴らす。wrtc の RTCAudioSink がデコード済みの PCM（10ms ごと）をくれるので、
// 相手ごとに溜めて混ぜ（足し算）、sox の play コマンドへ流し込む。
// Node には標準のスピーカー出力が無いので sox に任せる（brew install sox / apt install sox）。
// ★--ignore-length は外さないこと。macOS ではパイプの fstat が「いま溜まっているバイト数」を返すので、
//   sox がそれを全体の長さだと思い込み、最初の数十ミリ秒を鳴らしたところで終了してしまう。
import { spawn } from 'child_process';
import { RTCAudioSink } from './polyfill.mjs';

const RATE = 48000;            // 出力は 48kHz・モノラル・16bit
const TICK_MS = 20;            // 混ぜて書き出す間隔
const MAX_QUEUE = RATE * 0.3;  // 相手ごとに溜める上限（300ms）。超えたら古い分を捨てて遅れを溜めない
const TALK_RMS = 600;          // これより大きければ「話している」とみなす
const TALK_HOLD_MS = 800;

// 届いたフレームを 48kHz モノラルにそろえる（ステレオは平均、違うレートは線形補間）
export function toMono48k({ samples, sampleRate, channelCount, numberOfFrames }) {
  const ch = channelCount || 1, n = numberOfFrames || samples.length / ch;
  let mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += samples[i * ch + c];
    mono[i] = s / ch;
  }
  if (sampleRate && sampleRate !== RATE) {
    const out = new Float32Array(Math.round(n * RATE / sampleRate));
    for (let i = 0; i < out.length; i++) {
      const x = i * sampleRate / RATE, j = Math.floor(x), f = x - j;
      out[i] = (mono[j] ?? 0) * (1 - f) + (mono[j + 1] ?? mono[j] ?? 0) * f;
    }
    mono = out;
  }
  return mono;
}

export function openSpeaker({ onError = () => {} } = {}) {
  const sources = new Map();   // peerId -> { sink, trackId, queue: Float32Array[], queued, talkAt }
  let muted = false, closed = false, failed = false;

  const play = spawn('play', ['--ignore-length', '-q', '-t', 'raw', '-r', String(RATE), '-e', 'signed-integer', '-b', '16', '-c', '1', '-'],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  play.stderr.on('data', d => { stderr = (stderr + d).slice(-300); });
  const fail = msg => { if (!failed && !closed) { failed = true; onError(msg); } };
  play.on('error', e => fail(e.code === 'ENOENT'
    ? '音を鳴らすには sox が必要です（brew install sox / apt install sox）。今回は音なしで続けます'
    : '音の出力が止まりました: ' + e.message));
  play.on('exit', code => fail(`音の出力（sox）が終了しました（${code}${stderr.trim() ? '：' + stderr.trim().split('\n').pop() : ''}）。今回は音なしで続けます`));
  play.stdin.on('error', () => {});

  // 経過時間ぶんだけ書き出す（setInterval のずれが積もって音が詰まったり途切れたりしないように）
  let last = performance.now(), carry = 0;
  const timer = setInterval(() => {
    if (failed) return;
    const now = performance.now();
    carry += (now - last) * RATE / 1000; last = now;
    const n = Math.floor(carry); carry -= n;
    if (n <= 0) return;
    const mix = new Float32Array(n);
    for (const src of sources.values()) {
      let i = 0;
      while (i < n && src.queue.length) {
        const head = src.queue[0], take = Math.min(head.length, n - i);
        for (let k = 0; k < take; k++) mix[i + k] += head[k];
        i += take; src.queued -= take;
        if (take === head.length) src.queue.shift(); else src.queue[0] = head.subarray(take);
      }
    }
    const out = Buffer.alloc(n * 2);
    if (!muted) for (let i = 0; i < n; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mix[i]))), i * 2);
    play.stdin.write(out);
  }, TICK_MS);

  function detach(peerId) {
    const src = sources.get(peerId);
    if (!src) return;
    try { src.sink.stop(); } catch {}
    sources.delete(peerId);
  }

  return {
    // 相手の音声トラックをつなぐ。同じ相手から新しいトラックが来たら（送り直し）差し替える＝1人1本
    attach(peerId, track) {
      if (closed || failed) return;
      if (sources.get(peerId)?.trackId === track.id) return;
      detach(peerId);
      const src = { sink: new RTCAudioSink(track), trackId: track.id, queue: [], queued: 0, talkAt: 0 };
      src.sink.ondata = frame => {
        const mono = toMono48k(frame);
        let sq = 0; for (const v of mono) sq += v * v;
        if (Math.sqrt(sq / mono.length) > TALK_RMS) src.talkAt = Date.now();
        src.queue.push(mono); src.queued += mono.length;
        while (src.queued > MAX_QUEUE && src.queue.length) src.queued -= src.queue.shift().length;
      };
      sources.set(peerId, src);
    },
    detach,
    talking: peerId => Date.now() - (sources.get(peerId)?.talkAt || 0) < TALK_HOLD_MS,
    hearing: peerId => sources.has(peerId),
    setMuted: on => { muted = !!on; },
    get muted() { return muted; },
    get available() { return !failed; },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      [...sources.keys()].forEach(detach);
      try { play.stdin.end(); } catch {}
      setTimeout(() => { try { play.kill(); } catch {} }, 300);
    }
  };
}
