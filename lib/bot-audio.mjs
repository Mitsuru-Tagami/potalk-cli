/**
 * BOT専用の音声入力契約。外部サービスや実部屋へ接続せず検証できる純粋モジュール。
 */
export const BOT_AUDIO_CONTRACT = 'potalk-bot-audio-v1';
export const BOT_AUDIO_PIPEWIRE_CAPABILITY = 'potalk-bot-audio-pipewire-v1';
export const BOT_AUDIO_SOURCE_RE = /^BotSink_[A-Za-z0-9]+\.monitor$/;

export function parseBotAudioSource(args = [], { command = null } = {}) {
  const values = [];
  const argv = Array.from(args, String);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bot-audio-source') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new TypeError('--bot-audio-source requires one value');
      values.push(argv[++i]);
    } else if (argv[i].startsWith('--bot-audio-source=')) {
      throw new TypeError('--bot-audio-source must be written as a separate option and value');
    }
  }
  if (values.length > 1) throw new TypeError('--bot-audio-source must not be specified more than once');
  if (values.length && command !== null && !['join', 'create', '参加する', '参加', '部屋をつくる', '作成'].includes(command)) {
    throw new TypeError('--bot-audio-source is only supported by join/create');
  }
  return values.length ? validateBotAudioSource(values[0]) : null;
}

export function parseBotAudioPipewire(args = [], { command = null, env = process.env } = {}) {
  const argv = Array.from(args, String);
  if (argv.some(arg => arg.startsWith('--bot-audio-pipewire='))) {
    throw new TypeError('--bot-audio-pipewire must be a flag without a value');
  }
  const enabled = argv.filter(arg => arg === '--bot-audio-pipewire').length;
  if (enabled > 1) throw new TypeError('--bot-audio-pipewire must not be specified more than once');
  if (!enabled) return null;
  if (command !== null && !['join', 'create', '参加する', '参加', '部屋をつくる', '作成'].includes(command)) {
    throw new TypeError('--bot-audio-pipewire is only supported by join/create');
  }
  return validatePipewireEnv(env);
}

export function validatePipewireEnv(env = process.env) {
  const remote = env.POTALK_BOT_PW_REMOTE;
  const serial = env.POTALK_BOT_PW_SERIAL;
  if (typeof remote !== 'string' || !remote.startsWith('/') || remote.includes('\0')) {
    throw new TypeError('POTALK_BOT_PW_REMOTE must be an absolute socket path');
  }
  if (typeof serial !== 'string' || !/^\d+$/.test(serial) || !Number.isSafeInteger(Number(serial)) || Number(serial) <= 0) {
    throw new TypeError('POTALK_BOT_PW_SERIAL must be a positive decimal object.serial');
  }
  return { remote, serial };
}

export function validateBotAudioSource(source) {
  if (typeof source !== 'string' || !BOT_AUDIO_SOURCE_RE.test(source)) {
    throw new TypeError('bot audio source must match ^BotSink_[A-Za-z0-9]+\\.monitor$');
  }
  return source;
}
export function isBotAudioSource(source) { return typeof source === 'string' && BOT_AUDIO_SOURCE_RE.test(source); }

export function enableBotAudio(session, source) {
  validateBotAudioSource(source);
  if (!session || typeof session.setTalk !== 'function') throw new TypeError('session.setTalk is required for bot audio');
  if (session.room?.canTalk === false || session.canTalk === false) return session;
  session.setTalk(true);
  return session;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  if (process.argv[2] === '--check') process.stdout.write(BOT_AUDIO_CONTRACT);
  if (process.argv[2] === '--check-pipewire') process.stdout.write(BOT_AUDIO_PIPEWIRE_CAPABILITY);
}
