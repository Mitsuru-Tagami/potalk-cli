// 一時PulseAudioサーバーとnull sinkだけでテストする。既存音声サーバーを変更しない。
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, chmodSync, rmSync, openSync, closeSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
if (process.platform !== 'linux') throw new Error('Linux only');
const directory = mkdtempSync(join(tmpdir(), 'potalk-audio-test-'));
chmodSync(directory, 0o700);
const socket = join(directory, 'native');
const log = join(directory, 'server.log');
const fd = openSync(log, 'w', 0o600);
const env = { ...process.env, XDG_RUNTIME_DIR: directory,
  DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=' + join(directory, 'no-system-bus'),
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(directory, 'no-session-bus'),
  PULSE_SERVER: 'unix:' + socket };
let server;
let result = 1;
try {
  const build = spawnSync(process.execPath, ['scripts/build-bot-audio.mjs'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('native build failed');
  server = spawn('pulseaudio', ['-n', '--daemonize=no', '--high-priority=no', '--realtime=no',
    '--exit-idle-time=-1', '--use-pid-file=no', '--log-target=stderr',
    '--load=module-native-protocol-unix socket=' + socket + ' auth-anonymous=1',
    '--load=module-null-sink sink_name=DefaultDecoy rate=48000'], { env, stdio: ['ignore', fd, fd] });
  let startError;
  server.on('error', error => { startError = error; });
  const deadline = Date.now() + 10000;
  let ready = false;
  while (Date.now() < deadline) {
    if (startError) throw startError;
    if (server.exitCode !== null) throw new Error('test audio server stopped');
    const probe = spawnSync('pactl', ['info'], { env, encoding: 'utf8', timeout: 500 });
    if (probe.status === 0) { ready = true; break; }
    await delay(100);
  }
  if (!ready) throw new Error('test audio server startup timeout');
  console.log('ISOLATED_SERVER: ' + socket + ' (null sink only; no physical devices)');
  const child = spawn(process.execPath, ['--test', 'test/bot-audio-real.test.mjs'], {
    cwd: root, env: { ...env, PTK_ISOLATED_AUDIO_TEST: '1' }, stdio: 'inherit'
  });
  result = await new Promise((resolveResult, reject) => {
    child.on('error', reject); child.on('exit', code => resolveResult(code ?? 1));
  });
} catch (error) {
  console.error(error.message);
  try { console.error(readFileSync(log, 'utf8')); } catch {}
} finally {
  if (server) {
    const exited = new Promise(resolveExit => server.once('exit', resolveExit));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(1000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await Promise.race([exited, delay(1000)]); }
  }
  closeSync(fd);
  rmSync(directory, { recursive: true, force: true });
}
process.exitCode = result;
