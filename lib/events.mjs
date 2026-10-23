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

/**
 * 既知参加者の入退室を、外部スクリプト向けJSON Lines形式にします。
 * @param {{action:'join'|'leave',name:string,clean?:boolean}} event
 * @returns {string} JSON Linesの1レコード（改行は呼び出し側で追加）
 */
export function serializePresence(event) {
  const { action, name, clean } = event || {};
  if (!['join', 'leave'].includes(action) || typeof name !== 'string' || !name) {
    throw new TypeError('入退室イベントにはjoin/leaveのactionとname文字列が必要です');
  }
  if (clean !== undefined && typeof clean !== 'boolean') {
    throw new TypeError('cleanはbooleanである必要があります');
  }
  const record = { type: 'presence', action, name };
  if (action === 'leave' && clean !== undefined) record.clean = clean;
  return JSON.stringify(record);
}
