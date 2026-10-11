// 木の芽システム。本家と同じ参加回数・利用日数・累積滞在時間で段階を決める。
// CLIの記録はブラウザの localStorage とは独立して ~/.config/ptk/growth.json に保存する。
import fs from 'fs';
import os from 'os';
import path from 'path';

export const GROWTH_TICK_MS = 30_000;
export const GROWTH_TICK_SECONDS = GROWTH_TICK_MS / 1000;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;
const STAGES = new Set(['🌱', '🌿', '🌷', '🌻', '🌲', '🌳']);
const emptyStats = () => ({ seconds: 0, joins: 0, days: 0, lastDay: '' });

export const growthPath = () => path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'ptk', 'growth.json'
);

const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const dayString = date => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

function cleanStats(value) {
  const stats = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    seconds: count(stats.seconds),
    joins: count(stats.joins),
    days: count(stats.days),
    lastDay: typeof stats.lastDay === 'string' && /^\d{4}-\d{1,2}-\d{1,2}$/.test(stats.lastDay)
      ? stats.lastDay : ''
  };
}

/** Read locally persisted growth data, falling back safely if it is missing or malformed. */
export function loadGrowthStats(file = growthPath()) {
  try { return cleanStats(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { return emptyStats(); }
}

/** Persist only validated counters; failure must not prevent joining a call. */
export function saveGrowthStats(stats, file = growthPath()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cleanStats(stats), null, 2) + '\n');
    return true;
  } catch { return false; }
}

/** Begin a call: count one join and at most one active day for this local calendar date. */
export function startGrowthSession({ now = new Date(), file = growthPath() } = {}) {
  const stats = loadGrowthStats(file);
  const today = dayString(now instanceof Date ? now : new Date(now));
  stats.joins = Math.min(MAX_COUNT, stats.joins + 1);
  if (stats.lastDay !== today) {
    stats.days = Math.min(MAX_COUNT, stats.days + 1);
    stats.lastDay = today;
  }
  saveGrowthStats(stats, file);

  return {
    /** Add elapsed call time in seconds and persist it. */
    addTime(seconds = GROWTH_TICK_SECONDS) {
      const elapsed = count(seconds);
      stats.seconds = Math.min(MAX_COUNT, stats.seconds + elapsed);
      saveGrowthStats(stats, file);
      return growthStage(stats);
    },
    stage: () => growthStage(stats),
    stats: () => ({ ...stats })
  };
}

/** Return the stage emoji for validated growth statistics, using the original thresholds. */
export function growthStage(value = {}) {
  const stats = cleanStats(value);
  const minutes = stats.seconds / 60;
  const averageMinutes = stats.joins ? minutes / stats.joins : 0;
  if (stats.days >= 14 && minutes >= 180 && stats.joins >= 20) return averageMinutes < 12 ? '🌲' : '🌳';
  if (stats.days >= 4 && minutes >= 60 && stats.joins >= 10) return averageMinutes < 12 ? '🌷' : '🌻';
  if (stats.joins >= 3 && minutes >= 5) return '🌿';
  return '🌱';
}

/** Accept only known stage badges from remote peers; never display arbitrary peer-supplied text. */
export function sanitizeGrowthStage(value) {
  return typeof value === 'string' && STAGES.has(value) ? value : '';
}
