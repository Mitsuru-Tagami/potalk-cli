import { spawn } from 'child_process';
import { describeMicLevels, formatMicMeter, formatDbfs } from './mic-level.mjs';

export const MIC_TEST_DURATION_MS = 5000;

const REC_ARGS = ['-q', '-t', 'raw', '-r', '48000', '-e', 'signed-integer', '-b', '16', '-c', '1', '-'];
const PLAY_ARGS = ['--ignore-length', '-q', '-t', 'raw', '-r', '48000', '-e', 'signed-integer', '-b', '16', '-c', '1', '-'];

const errorText = (error, stderr = '') => {
  if (error?.code === 'ENOENT') return 'SoXの rec コマンドが見つかりません。SoXをインストールし、PATHを確認してください。';
  const detail = String(stderr || '').trim().split('\n').at(-1);
  if (detail) return `SoXのマイク入力に失敗しました: ${detail}`;
  if (error?.message) return `SoXのマイク入力に失敗しました: ${error.message}`;
  return 'SoXのマイク入力に失敗しました。';
};

/** 生PCMはメモリ上だけで扱い、一時ファイルも永続ファイルも作りません。 */
export function captureMicTest({ durationMs = MIC_TEST_DURATION_MS, onProgress = () => {}, spawnImpl = spawn } = {}) {
  return new Promise(resolve => {
    const chunks = [];
    let sumSquares = 0, samples = 0, peak = 0, clippedSamples = 0;
    let carry = null, stderr = '', stopping = false, settled = false;
    let captureTimer, progressTimer, forceKillTimer;
    const startedAt = Date.now();
    const snapshot = () => ({
      samples,
      rms: samples ? Math.sqrt(sumSquares / samples) : 0,
      peak,
      clippedSamples
    });
    const elapsed = () => Math.max(0, Date.now() - startedAt);
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(captureTimer);
      clearTimeout(forceKillTimer);
      clearInterval(progressTimer);
      resolve({ ...result, elapsedMs: elapsed() });
    };
    const reportProgress = () => {
      try { onProgress({ ...snapshot(), elapsedMs: elapsed() }); } catch {}
    };

    let rec;
    try {
      rec = spawnImpl('rec', REC_ARGS, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      finish({ ok: false, error: errorText(error) });
      return;
    }

    rec.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-500); });
    rec.stdout.on('data', data => {
      let buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (carry) { buffer = Buffer.concat([carry, buffer]); carry = null; }
      if (buffer.length % 2) {
        carry = buffer.subarray(buffer.length - 1);
        buffer = buffer.subarray(0, buffer.length - 1);
      }
      if (!buffer.length) return;
      chunks.push(buffer);
      const count = buffer.length / 2;
      for (let i = 0; i < count; i++) {
        const value = buffer.readInt16LE(i * 2);
        const absolute = Math.abs(value);
        sumSquares += value * value;
        samples++;
        if (absolute > peak) peak = absolute;
        if (absolute >= 32000) clippedSamples++;
      }
    });
    rec.once('error', error => finish({ ok: false, error: errorText(error, stderr), stderr }));
    rec.once('close', (code, signal) => {
      if (!stopping) {
        const detail = String(stderr || '').trim().split('\n').at(-1);
        finish({ ok: false, error: detail
          ? `SoXの録音が途中で終了しました: ${detail}`
          : `SoXの録音が途中で終了しました（${code ?? signal ?? '不明'}）。`, stderr });
        return;
      }
      finish({ ok: true, stats: snapshot(), buffer: Buffer.concat(chunks), stderr });
    });

    progressTimer = setInterval(reportProgress, 250);
    captureTimer = setTimeout(() => {
      stopping = true;
      try { rec.kill('SIGTERM'); } catch {}
      forceKillTimer = setTimeout(() => { try { rec.kill('SIGKILL'); } catch {} }, 1000);
    }, Math.max(1, durationMs));
    reportProgress();
  });
}

/** メモリ上のPCMをSoXで再生し、録音ファイルは作りません。 */
export function playCapturedAudio(buffer, { spawnImpl = spawn } = {}) {
  if (!buffer?.length) return Promise.resolve({ ok: false, error: '再生できる音声データがありません。' });
  return new Promise(resolve => {
    let settled = false, stderr = '';
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let player;
    try {
      player = spawnImpl('play', PLAY_ARGS, { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (error) {
      finish({ ok: false, error: errorText(error) });
      return;
    }
    player.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-500); });
    player.once('error', error => finish({ ok: false, error: errorText(error, stderr), stderr }));
    player.once('close', code => finish(code === 0
      ? { ok: true }
      : { ok: false, error: `SoXの play が終了しました（${code ?? '不明'}）${stderr.trim() ? `: ${stderr.trim().split('\n').at(-1)}` : '。'}`, stderr }));
    player.stdin.once('error', error => finish({ ok: false, error: `再生へ音声を渡せませんでした: ${error.message}` }));
    player.stdin.end(buffer);
  });
}

export async function runMicTest({
  output = process.stderr,
  durationMs = MIC_TEST_DURATION_MS,
  spawnImpl = spawn,
  playSpawnImpl = spawn
} = {}) {
  const seconds = (durationMs / 1000).toFixed(0);
  output.write(`既定のマイク入力を ${seconds} 秒テストします。録音データは保存しません。\n`);
  const captured = await captureMicTest({
    durationMs,
    spawnImpl,
    onProgress: progress => {
      if (output.isTTY) {
        const elapsedSeconds = Math.min(durationMs, progress.elapsedMs) / 1000;
        output.write(`\r🎙 ${formatMicMeter(progress)}  ${elapsedSeconds.toFixed(1)} / ${seconds} 秒`);
      }
    }
  });
  if (output.isTTY) output.write('\n');
  if (!captured.ok) {
    output.write(`マイクテストに失敗しました: ${captured.error}\n`);
    return false;
  }

  const { rms, peak, samples, clippedSamples } = captured.stats;
  output.write(`測定結果: RMS ${Math.round(rms)} (${formatDbfs(rms)} dBFS) / peak ${Math.round(peak)} (${formatDbfs(peak)} dBFS) / ${samples} samples\n`);
  for (const note of describeMicLevels(captured.stats)) output.write(`判定目安: ${note}\n`);
  if (clippedSamples) output.write(`フルスケール近傍のサンプル: ${clippedSamples} 個（音割れの可能性を示す目安）\n`);

  if (peak > 0 && captured.buffer.length) {
    output.write('録音データを保存せず、SoXでこの場でローカル再生します。\n');
    const playback = await playCapturedAudio(captured.buffer, { spawnImpl: playSpawnImpl });
    if (!playback.ok) output.write(`ローカル再生はできませんでした: ${playback.error}\n`);
  } else {
    output.write('入力が検出されなかったため、ローカル再生は省略しました。\n');
  }
  output.write('この測定で分かるのはSoXからCLIへ届いた入力レベルだけです。物理マイクの品質や、相手までの回線品質は判定できません。\n');
  return true;
}
