/**
 * 受信したチャットコメントを、外部スクリプト向けJSON Lines形式にします。
 * @param {{from:string, text:string}} event - 相手の表示名とコメント本文
 * @returns {string} JSON Linesの1レコード（改行は呼び出し側で追加）
 */
export function serializeReceivedChat(event) {
  const { from, text } = event || {};
  if (typeof from !== 'string' || typeof text !== 'string') {
    throw new TypeError('受信コメントにはfromとtextの文字列が必要です');
  }
  return JSON.stringify({ type: 'chat', from, text });
}
