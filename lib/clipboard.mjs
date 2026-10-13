import { spawn as nodeSpawn } from 'node:child_process';

function commandsFor(platform, env) {
  if (platform === 'linux') {
    const waylandFirst = Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === 'wayland';
    const wayland = { command: 'wl-copy', args: [] };
    const x11 = [
      { command: 'xclip', args: ['-selection', 'clipboard'] },
      { command: 'xsel', args: ['--clipboard', '--input'] }
    ];
    return waylandFirst ? [wayland, ...x11] : [...x11, wayland];
  }
  if (platform === 'darwin') return [{ command: 'pbcopy', args: [] }];
  if (platform === 'win32') return [{ command: 'clip.exe', args: [] }];
  return [];
}

function runClipboardCommand(command, text, spawnProcess) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(command.command, command.args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    let spawnError;
    let inputError;
    let stderr = '';
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', chunk => {
      if (stderr.length < 4096) stderr += String(chunk).slice(0, 4096 - stderr.length);
    });
    child.on('error', error => { spawnError = error; });
    child.stdin?.on('error', error => { inputError = error; });
    child.on('close', (code, signal) => {
      if (spawnError) return reject(spawnError);
      if (inputError) return reject(inputError);
      if (code === 0) return resolve();
      const detail = stderr.trim() || (signal ? `terminated by ${signal}` : `exited with code ${code}`);
      reject(new Error(detail));
    });

    if (!child.stdin) {
      reject(new Error('clipboard command has no stdin pipe'));
      child.kill?.();
      return;
    }
    try {
      child.stdin.end(text, 'utf8');
    } catch (error) {
      reject(error);
      child.kill?.();
    }
  });
}

/**
 * OS付属またはディストリビューション標準のコマンドへ、シェルを介さず文字列を渡す書き込み関数を作ります。
 * LinuxではWaylandのwl-copy、X11のxclip／xselを利用可能な順で試します。
 */
export function createClipboardWriter({
  platform = process.platform,
  env = process.env,
  spawnProcess = nodeSpawn
} = {}) {
  const commands = commandsFor(platform, env);
  return async text => {
    if (commands.length === 0) {
      throw new Error(`No native clipboard command is configured for ${platform}`);
    }

    const failures = [];
    for (const command of commands) {
      try {
        await runClipboardCommand(command, text, spawnProcess);
        return;
      } catch (error) {
        failures.push(`${command.command}: ${error.message}`);
      }
    }
    throw new Error(`All native clipboard commands failed (${failures.join('; ')})`);
  };
}

const writeNativeClipboard = createClipboardWriter();

/**
 * 部屋URLをクリップボードに書き込み、結果を画面に通知します。
 * @param {string} url - コピーするURL
 * @param {{write?: (text:string)=>Promise<void>, onText?: (text:string)=>void}} options
 * @returns {Promise<boolean>} コピーに成功したか
 */
export async function copyRoomUrl(url, { write = writeNativeClipboard, onText = () => {} } = {}) {
  try {
    await write(url);
    onText('📋 クリップボードに部屋のURLをコピーしました！');
    return true;
  } catch {
    onText('⚠️ クリップボードにコピーできませんでした。端末のクリップボード機能を確認してください。');
    return false;
  }
}
