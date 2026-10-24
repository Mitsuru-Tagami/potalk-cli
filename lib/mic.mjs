// 通常マイクは従来どおりrec。BOTはALSA pulseを専用monitorに固定する。
// ミュート・異常終了時は録音プロセスと未送信PCMを両方破棄する。
import { spawn } from 'child_process';
import { validateBotAudioSource } from './bot-audio.mjs';
import { prepareBotRecorder } from './bot-recorder.mjs';

const RATE = 48000;
const MAX_QUEUE = RATE * 0.2;
const READY = 'PTK_NO_MOVE_V1\n';
const RAW_ARGS = ['-q', '-t', 'raw', '-r', String(RATE), '-e', 'signed-integer', '-b', '16', '-c', '1', '-'];

export function openMic({ onError = () => {}, spawnImpl = spawn, pulseSource = null,
  prepareBotRecorderImpl = prepareBotRecorder, readyTimeoutMs = 5000 } = {}) {
  if (pulseSource !== null) validateBotAudioSource(pulseSource);
  let active = null, queue = [], queued = 0, level = 0;
  let meterSquares = 0, meterSamples = 0, meterPeak = 0;

  function clearAudio() {
    queue = []; queued = 0; level = 0;
    meterSquares = 0; meterSamples = 0; meterPeak = 0;
  }

  function dispose(state) {
    clearTimeout(state.timer);
    try { state.proc?.kill(pulseSource === null ? 'SIGTERM' : 'SIGKILL'); } catch {}
    try { state.cleanup?.(); } catch {}
  }

  function fail(state, message) {
    if (active !== state) return;
    active = null;
    clearAudio();
    dispose(state);
    onError(message);
  }

  function start() {
    if (active) return true;
    clearAudio();
    const state = { proc: null, cleanup: null, ready: pulseSource === null, timer: null };
    active = state;
    let command = 'rec', args = RAW_ARGS, options = { stdio: ['ignore', 'pipe', 'pipe'] };
    try {
      if (pulseSource !== null) {
        const prepared = prepareBotRecorderImpl(pulseSource);
        ({ command, args, options } = prepared);
        state.cleanup = prepared.cleanup;
      }
      state.proc = spawnImpl(command, args, options);
    } catch (error) {
      fail(state, '録音を開始できませんでした: ' + error.message);
      return false;
    }
    const proc = state.proc;
    let stderr = '', carry = null;
    proc.stderr.on('data', d => { if (active === state) stderr = (stderr + d).slice(-500); });
    function awaitAudio() {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => fail(state, 'BOT録音のPCMが届きません。送音を停止します'), readyTimeoutMs);
      state.timer.unref?.();
    }
    proc.stdout.on('data', buf => {
      // 古いプロセス、または移動禁止設定の確認前のPCMは絶対に送らない。
      if (active !== state || !state.ready) return;
      if (pulseSource !== null && buf.length) awaitAudio();
      if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
      if (buf.length % 2) { carry = buf.subarray(buf.length - 1); buf = buf.subarray(0, buf.length - 1); }
      const samples = new Int16Array(buf.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2);
      let sq = 0;
      for (const value of samples) {
        sq += value * value;
        meterSquares += value * value;
        meterSamples++;
        meterPeak = Math.max(meterPeak, Math.abs(value));
      }
      level = samples.length ? Math.sqrt(sq / samples.length) : 0;
      if (samples.length >= MAX_QUEUE) {
        queue = [samples.subarray(samples.length - MAX_QUEUE)]; queued = MAX_QUEUE;
      } else {
        queue.push(samples); queued += samples.length;
        while (queued > MAX_QUEUE && queue.length) queued -= queue.shift().length;
      }
    });
    proc.on('error', error => fail(state, error.code === 'ENOENT'
      ? 'マイクを使うには sox が必要です（brew install sox / apt install sox）'
      : 'マイクを開けませんでした: ' + error.message));
    const exited = code => {
      const why = stderr.trim().split('\n').pop() || '';
      fail(state, `マイクが止まりました（${code}${why ? '：' + why : ''}）。`
        + (process.platform === 'darwin' ? 'macOSならマイク権限を確認してください' : ''));
    };
    proc.on('exit', exited);
    proc.on('close', exited);
    if (pulseSource !== null) {
      const control = proc.stdio?.[3];
      if (!control) {
        fail(state, 'BOT録音の移動禁止確認パイプがありません。送音を停止します');
        return false;
      }
      let token = '';
      state.timer = setTimeout(() => fail(state, 'BOT録音の移動禁止設定を確認できません。送音を停止します'), readyTimeoutMs);
      state.timer.unref?.();
      control.on('data', chunk => {
        if (active !== state || state.ready) return;
        token += chunk.toString('ascii');
        if (!READY.startsWith(token)) {
          fail(state, 'BOT録音の移動禁止確認が不正です。送音を停止します');
        } else if (token === READY) {
          state.ready = true;
          awaitAudio();
        }
      });
      control.on('end', () => {
        if (!state.ready) fail(state, 'BOT録音の移動禁止設定が適用されていません。送音を停止します');
      });
      control.on('error', () => fail(state, 'BOT録音の移動禁止確認に失敗しました。送音を停止します'));
    }
    return active === state;
  }

  function stop() {
    const state = active;
    active = null;
    clearAudio();
    if (state) dispose(state);
  }

  return {
    start, stop,
    get running() { return !!active; },
    take(n) {
      if (queued < n) return null;
      const out = new Int16Array(n);
      let i = 0;
      while (i < n) {
        const head = queue[0], count = Math.min(head.length, n - i);
        out.set(head.subarray(0, count), i);
        i += count; queued -= count;
        if (count === head.length) queue.shift(); else queue[0] = head.subarray(count);
      }
      return out;
    },
    level: () => level,
    readMeter() {
      const meter = { rms: meterSamples ? Math.sqrt(meterSquares / meterSamples) : 0,
        peak: meterPeak, samples: meterSamples };
      meterSquares = 0; meterSamples = 0; meterPeak = 0;
      return meter;
    }
  };
}
