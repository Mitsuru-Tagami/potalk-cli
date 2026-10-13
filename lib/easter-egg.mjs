import { spawn } from 'node:child_process';

// 入力欄へ並びを貼って Enter。矢印キーそのものは既存のカーソル操作に残す。
export const EASTER_EGG_INPUT = '↑↑↓↓←→←→BA';
export const EASTER_EGG_COMMAND = '/konami';

// 昔ながらの単旋律を短く手入力したMML。録音・編曲音源・譜面ファイルは同梱しない。
export const AULD_LANG_SYNE_MML = 'T156 O4 L8 C4 F4. F F4 A4 G4. F G4 A4 F4. F A4 >C4 D2. D4 <C4. A A4 F4 G4. F G4 A4 F4. D D4 C4 F2. >D4';
const SAMPLE_RATE = 22050;
const PITCH = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });

export function isEasterEggInput(value) {
  return String(value ?? '').trim() === EASTER_EGG_INPUT;
}

/** MMLの小さな部分集合（テンポ・オクターブ・音価・休符・音符・臨時記号）を読む。 */
export function parseMml(source) {
  const compact = String(source ?? '').replace(/\s+/gu, '');
  const tokens = compact.match(/[TtOoLl]\d+|[><]|[A-Ga-gRr][#+-]?\d*\.?/gu) || [];
  if (tokens.join('') !== compact) throw new Error('MMLに未対応の文字があります');

  let tempo = 120, octave = 4, defaultLength = 4;
  const events = [];
  for (const token of tokens) {
    const directive = /^([TtOoLl])(\d+)$/u.exec(token);
    if (directive) {
      const value = Number(directive[2]);
      if (directive[1].toUpperCase() === 'T') {
        if (value < 30 || value > 300) throw new Error('MMLのテンポは30〜300にしてください');
        tempo = value;
      } else if (directive[1].toUpperCase() === 'O') {
        if (value < 0 || value > 8) throw new Error('MMLのオクターブは0〜8にしてください');
        octave = value;
      } else {
        if (value < 1 || value > 64) throw new Error('MMLの音価が範囲外です');
        defaultLength = value;
      }
      continue;
    }
    if (token === '>') { octave = Math.min(8, octave + 1); continue; }
    if (token === '<') { octave = Math.max(0, octave - 1); continue; }

    const note = /^([A-Ga-gRr])([#+-]?)(\d*)(\.?)$/u.exec(token);
    if (!note) throw new Error(`MMLの音符が正しくありません: ${token}`);
    const name = note[1].toUpperCase();
    const denominator = note[3] ? Number(note[3]) : defaultLength;
    if (denominator < 1 || denominator > 64) throw new Error('MMLの音価が範囲外です');
    const beats = (4 / denominator) * (note[4] ? 1.5 : 1);
    const event = { durationMs: (60000 / tempo) * beats, frequency: null };
    if (name !== 'R') {
      const accidental = note[2] === '#' || note[2] === '+' ? 1 : note[2] === '-' ? -1 : 0;
      const midi = (octave + 1) * 12 + PITCH[name] + accidental;
      event.frequency = 440 * (2 ** ((midi - 69) / 12));
    }
    events.push(event);
  }
  return events;
}

const SONG_EVENTS = parseMml(AULD_LANG_SYNE_MML);
export const AULD_LANG_SYNE_DURATION_MS = SONG_EVENTS.reduce((sum, event) => sum + event.durationMs, 0);

/** PCMを実行時に合成する。生成データは外部ファイルへ書き出さない。 */
export function renderMmlPcm(source = AULD_LANG_SYNE_MML, { sampleRate = SAMPLE_RATE, volume = 0.18 } = {}) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('サンプルレートが範囲外です');
  const events = parseMml(source);
  const frames = events.reduce((sum, event) => sum + Math.max(1, Math.round(event.durationMs * sampleRate / 1000)), 0);
  const pcm = Buffer.alloc(frames * 2);
  let cursor = 0;
  for (const event of events) {
    const count = Math.max(1, Math.round(event.durationMs * sampleRate / 1000));
    if (event.frequency) {
      const attack = Math.max(1, Math.round(sampleRate * 0.008));
      const release = Math.max(1, Math.round(sampleRate * 0.012));
      for (let i = 0; i < count; i++) {
        const envelope = Math.min(1, i / attack, (count - 1 - i) / release);
        const sample = Math.sin(2 * Math.PI * event.frequency * i / sampleRate) * volume * Math.max(0, envelope);
        pcm.writeInt16LE(Math.round(sample * 32767), (cursor + i) * 2);
      }
    }
    cursor += count;
  }
  return pcm;
}

/** SoXのplayへ一度だけストリームする。未導入・失敗時は演出を止めず無音で続ける。 */
export function startMmlPlayback(source = AULD_LANG_SYNE_MML, { spawnImpl = spawn } = {}) {
  let child = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const running = child;
    child = null;
    try {
      if (running && running.exitCode == null && !running.killed) running.kill('SIGTERM');
    } catch { /* 端末終了時は音声プロセスの後始末を優先する */ }
  };

  let pcm;
  try {
    pcm = renderMmlPcm(source);
    child = spawnImpl('play', ['-q', '-t', 'raw', '-r', String(SAMPLE_RATE), '-e', 'signed-integer', '-b', '16', '-c', '1', '-'], {
      stdio: ['pipe', 'ignore', 'ignore']
    });
  } catch {
    return stop;
  }
  if (!child?.stdin?.end) { stop(); return stop; }

  const running = child;
  const failed = () => {
    if (child === running) child = null;
    stopped = true;
    try { if (running.exitCode == null && !running.killed) running.kill('SIGTERM'); } catch {}
  };
  running.on?.('error', failed);
  running.on?.('close', () => { if (child === running) child = null; stopped = true; });
  running.stdin.on?.('error', failed);
  try { running.stdin.end(pcm); } catch { failed(); }
  return stop;
}
