import clipboard from 'clipboardy';

/**
 * 部屋URLをクリップボードに書き込み、結果を画面に通知します。
 * @param {string} url - コピーするURL
 * @param {{write?: (text:string)=>Promise<void>, onText?: (text:string)=>void}} options
 * @returns {Promise<boolean>} コピーに成功したか
 */
export async function copyRoomUrl(url, { write = text => clipboard.write(text), onText = () => {} } = {}) {
  try {
    await write(url);
    onText('📋 クリップボードに部屋のURLをコピーしました！');
    return true;
  } catch {
    onText('⚠️ クリップボードにコピーできませんでした。端末のクリップボード機能を確認してください。');
    return false;
  }
}
