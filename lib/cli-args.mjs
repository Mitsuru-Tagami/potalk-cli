/** CLIのコマンド名と引数を解釈する。 */
export function parseCliArgs(argv) {
  const args = Array.from(argv || [], String);
  const bare = !args.length || (args[0].startsWith('-') && !['--help', '-h'].includes(args[0]));
  return {
    cmd: bare ? 'lobby' : args[0],
    rest: bare ? args : args.slice(1)
  };
}

/** ロビーに適用する起動オプション。--konami は一時テスト用。 */
export function parseLobbyOptions(args) {
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    const value = index >= 0 ? args[index + 1] : undefined;
    return value && !value.startsWith('--') ? value : fallback;
  };
  return {
    sound: !args.includes('--no-sound'),
    tts: option('tts', null),
    konami: args.includes('--konami')
  };
}
