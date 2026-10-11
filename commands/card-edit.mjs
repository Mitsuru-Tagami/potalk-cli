import { validateCardField } from '../lib/card.mjs';

const FIELDS = [
  ['bio', 'ひとこと（最大60文字）', card => card?.bio || ''],
  ['x', 'X ID（@なし）', card => card?.socials?.x || ''],
  ['github', 'GitHub ID', card => card?.socials?.github || ''],
  ['note', 'note ID', card => card?.socials?.note || ''],
  ['nostr', 'Nostr npub', card => card?.socials?.nostr || ''],
  ['tip', 'お礼の窓口（provider:id、例 kofi:potalk）', card => card?.tip ? `${card.tip.p}:${card.tip.id}` : ''],
  ['avatar', 'アイコンdata URL（WebP/JPEG/PNG、最大40,000文字）', card => card?.avatar ? '（設定済み。Enterで保持）' : '']
];

function parseField(key, value) {
  if (key === 'tip') {
    const split = value.indexOf(':');
    if (split <= 0) return null;
    return { tip: { p: value.slice(0, split), id: value.slice(split + 1) } };
  }
  if (['x', 'github', 'note', 'nostr'].includes(key)) return { socials: { [key]: value } };
  return { [key]: value };
}

/** Ask for card fields, validate each before saving, then sign and persist once. */
export async function editCardInteractive(cardManager, ask, onText = () => {}) {
  if (!cardManager || typeof cardManager.update !== 'function') {
    onText('名刺の保存機能を利用できません。');
    return false;
  }
  if (cardManager.invalidCard) onText('保存済み名刺の署名が一致しないため破棄しました。空の状態から再設定してください。');
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
        onText(`入力形式が正しくありません。${key === 'bio' ? '60文字以内で入力してください。' : '仕様に合うIDまたは値を入力してください。'}`);
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
    onText('名刺を署名して保存しました。/card <番号> で参加者の名刺を要求できます。');
    return true;
  } catch (error) {
    onText(`名刺を保存できませんでした: ${error?.message || error}`);
    return false;
  }
}
