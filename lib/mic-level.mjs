const FULL_SCALE = 32768;

export const MIC_LEVEL_THRESHOLDS = Object.freeze({
  nearSilentRms: 100,
  lowRms: 1000,
  highPeak: 32000
});

export function measureInt16(samples) {
  let sumSquares = 0;
  let peak = 0;
  let clippedSamples = 0;
  const count = samples?.length || 0;
  for (let i = 0; i < count; i++) {
    const value = Number(samples[i]) || 0;
    const absolute = Math.abs(value);
    sumSquares += value * value;
    if (absolute > peak) peak = absolute;
    if (absolute >= MIC_LEVEL_THRESHOLDS.highPeak) clippedSamples++;
  }
  return {
    samples: count,
    rms: count ? Math.sqrt(sumSquares / count) : 0,
    peak,
    clippedSamples
  };
}

export function dbfs(value) {
  const level = Number(value);
  if (!Number.isFinite(level) || level <= 0) return null;
  return 20 * Math.log10(Math.min(level, FULL_SCALE) / FULL_SCALE);
}

export function formatDbfs(value) {
  const db = dbfs(value);
  return db === null ? '-∞' : db.toFixed(0);
}

/** A compact, portable terminal meter scaled logarithmically over -60..0 dBFS. */
export function formatMicMeter({ rms = 0, peak = 0 } = {}, width = 12) {
  const columns = Math.max(1, Math.floor(Number(width) || 12));
  const db = dbfs(rms);
  const fraction = db === null ? 0 : Math.max(0, Math.min(1, (db + 60) / 60));
  const filled = Math.round(fraction * columns);
  const bar = '='.repeat(filled) + '.'.repeat(columns - filled);
  return `[${bar}] RMS ${formatDbfs(rms)} dBFS / peak ${formatDbfs(peak)} dBFS`;
}

export function describeMicLevels({ rms = 0, peak = 0 } = {}) {
  const notes = [];
  if (rms < MIC_LEVEL_THRESHOLDS.nearSilentRms) {
    notes.push('入力は無音に近い状態です。SoXの入力・OSのマイク許可・接続を確認してください。');
  } else if (rms < MIC_LEVEL_THRESHOLDS.lowRms) {
    notes.push('入力レベルは小さめです。マイクとの距離やOS側の入力音量を確認してください。');
  } else {
    notes.push('CLIには音声入力が届いています。');
  }
  if (peak >= MIC_LEVEL_THRESHOLDS.highPeak) {
    notes.push('ピークが非常に高く、音割れの可能性があります。');
  }
  return notes;
}
