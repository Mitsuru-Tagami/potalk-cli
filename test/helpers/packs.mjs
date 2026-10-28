// テスト用：同梱パックをすべて有効化した配線を用意する（利用者ディレクトリには触れない）
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareCommandPacks } from '../../lib/command-pack-store.mjs';

const tmp = mkdtempSync(path.join(tmpdir(), 'ptk-test-packs-'));
const prepared = prepareCommandPacks({
  userDir: path.join(tmp, 'commands'),
  activationPath: path.join(tmp, 'command-packs.json'),
  enableAllBundled: true,
  persistSeen: false,
});

export const allBundledPackOptions = {
  packDispatch: prepared.dispatch,
  packHelp: prepared.helpLines,
};
