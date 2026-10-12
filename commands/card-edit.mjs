import { normalizeSocialId, normalizeTipId, validateCardField } from '../lib/card.mjs';

const FIELDS = [
  ['bio', 'ひとこと（最大60文字）', card => card?.bio || ''],
  ['x', 'X IDまたはプロフィールURL', card => card?.socials?.x || ''],
  ['github', 'GitHub IDまたはプロフィールURL', card => card?.socials?.github || ''],
  ['note', 'note IDまたはプロフィールURL', card => card?.socials?.note || ''],
  ['instagram', 'Instagram IDまたはプロフィールURL', card => card?.socials?.instagram || ''],
  ['youtube', 'YouTube @ハンドルまたはチャンネルURL', card => card?.socials?.youtube || ''],
  ['nostr', 'Nostr npubまたはプロフィールURL', card => card?.socials?.nostr || ''],
  ['tip', 'お礼の窓口（ofuse/amazon/zap/kofi/bmac:id）', card => card?.tip ? `${card.tip.p}:${card.tip.id}` : ''],
  ['avatar', 'アイコンdata URL（WebP/JPEG/PNG、最大40,000文字）', card => card?.avatar ? '（設定済み。Enterで保持）' : '']
];

function parseField(key, value) {
  if (key === 'tip') {
    const split = value.indexOf(':');
    if (split <= 0) return null;
    const p = value.slice(0, split);
    const id = normalizeTipId(p, value.slice(split + 1));
    return id ? { tip: { p, id } } : null;
  }
  if (['x', 'github', 'note', 'instagram', 'youtube', 'nostr'].includes(key)) {
    const id = normalizeSocialId(key, value);
    return id ? { socials: { [key]: id } } : null;
  }
  return { [key]: value };
}

/** Ask for card fields, validate each before saving, then persist the un-signed card body. */
export async function editCardInteractive(cardManager, ask, onText = () => {}) {
  if (!cardManager || typeof cardManager.update !== 'function') {
    onText('名刺の保存機能を利用できません。');
    return false;
  }
  if (cardManager.invalidCard) onText('保存済み名刺の形式または鍵が一致しないため無効化しました。空の状態から再設定してください。');
  const current = cardManager.card;
  const changes = {};
  let changed = false;

  for (const [key, title, getCurrent] of FIELDS) {
    const old = getCurrent(current);
    while (true) {
      const value = await ask(`${title}${old ? ` [現在: ${old}]` : ''}（Enter: 維持、-: 削除）: `, old);
      if (value === null || value === undefined) {
        onText('名刺の編集を中止しました。');
        return false;
      }
      const text = String(value).trim();
      if (!text) break;
      if (text === '-') {
        if (key === 'tip' || key === 'avatar' || key === 'bio') changes[key] = null;
        else changes.socials = { ...(changes.socials || {}), [key]: null };
        changed = true;
        break;
      }
      const parsed = parseField(key, text);
      const field = key === 'tip' ? 'tip' : key === 'avatar' ? 'avatar' : key === 'bio' ? 'bio' : 'socials';
      if (!parsed || !validateCardField(field, field === 'socials' ? parsed.socials : parsed[field])) {
        onText(`入力形式が正しくありません。${key === 'bio' ? '60文字以内で入力してください。' : '本番仕様に合うIDまたは値を入力してください。'}`);
        continue;
      }
      if (key === 'tip' || key === 'avatar' || key === 'bio') changes[key] = parsed[key];
      else changes.socials = { ...(changes.socials || {}), ...parsed.socials };
      changed = true;
      break;
    }
  }

  if (!changed) {
    onText('変更はありません。空欄は既存値を維持しました。');
    return true;
  }
  try {
    await cardManager.update(changes);
    onText('名刺を保存しました（本文への署名やSNS本人確認は行わず、カード鍵は所持応答に使います）。');
    return true;
  } catch (error) {
    onText(`名刺を保存できませんでした: ${error?.message || error}`);
    return false;
  }
}
