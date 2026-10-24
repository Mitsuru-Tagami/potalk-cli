/**
 * BOT専用の音声入力契約。外部サービスや実部屋へ接続せず検証できる純粋モジュール。
 */
export const BOT_AUDIO_CONTRACT = 'potalk-bot-audio-v1';

// 専用ランナーが生成する sink 名だけを許可する。パスや引数は受け付けない。
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

/**
 * BOT音声ソース名を検証し、正規化を行わずそのまま返す。
 * @throws {TypeError} 型または許可された形式でない場合
 */
export function validateBotAudioSource(source) {
  if (typeof source !== 'string' || !BOT_AUDIO_SOURCE_RE.test(source)) {
    throw new TypeError('bot audio source must match ^BotSink_[A-Za-z0-9]+\\.monitor$');
  }
  return source;
}

export function isBotAudioSource(source) {
  return typeof source === 'string' && BOT_AUDIO_SOURCE_RE.test(source);
}

/**
 * BOT参加時の初期発話状態を一度だけ設定する。
 * toggle ではなく明示的な true を使うため、already-on を off にしない。
 */
export function enableBotAudio(session, source) {
  validateBotAudioSource(source);
  if (!session || typeof session.setTalk !== 'function') {
    throw new TypeError('session.setTalk is required for bot audio');
  }
  if (session.room?.canTalk === false || session.canTalk === false) return session;
  session.setTalk(true);
  return session;
}

// オフライン capability check: CLIや接続処理を起動せず契約文字列だけを出力する。
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href && process.argv[2] === '--check') {
  process.stdout.write(BOT_AUDIO_CONTRACT);
}
