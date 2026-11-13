import { addContentRule, findContentLocalization, saveApplicationLanguage, saveContentTranslation } from './content-localization.repository.js';
import type { ApplicationLanguage, CreateContentRuleRequest, LocalizedContentEntry } from './content-localization.interfaces.js';

export function createContentRule(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const rule = input as CreateContentRuleRequest;
  if (!Array.isArray(rule.translations) || !rule.translations.length) return false;
  const languages = findContentLocalization().languages;
  const seen = new Set<string>();
  for (const translation of rule.translations) {
    if (!translation || typeof translation.value !== 'string' || translation.value.length > 500
      || !languages.some(l => l.code === translation.languageCode) || seen.has(translation.languageCode)) return false;
    seen.add(translation.languageCode);
  }
  const english = rule.translations.find(t => t.languageCode === 'en')?.value.trim();
  if (!english) return false;
  const usesValue = english.includes('{{value}}');
  for (const translation of rule.translations) {
    if (!translation.value.trim()) continue;
    if (translation.value.includes('{{value}}') !== usesValue
      || /[{}]/.test(translation.value.replaceAll('{{value}}', ''))) return false;
  }
  for (const value of [rule.valueLabel, rule.defaultValue]) {
    if (value != null && (typeof value !== 'string' || value.length > 120)) return false;
  }
  if (usesValue && !rule.valueLabel?.trim()) return false;
  if (!usesValue && (rule.valueLabel?.trim() || rule.defaultValue?.trim())) return false;
  addContentRule({
    translations: rule.translations.map(t => ({ ...t, value: t.value.trim() })),
    valueLabel: usesValue ? rule.valueLabel!.trim() : null,
    defaultValue: usesValue ? rule.defaultValue?.trim() || null : null
  });
  return true;
}

export function getContentLocalization(includeUnreleased = false) { return findContentLocalization(includeUnreleased); }

export function updateApplicationLanguage(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const language = input as ApplicationLanguage;
  if (typeof language.code !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language.code) || language.code.length > 35
    || typeof language.name !== 'string' || !language.name.trim() || language.name.length > 80 || typeof language.enabled !== 'boolean'
    || (language.code === 'en' && !language.enabled)) return false;
  try { Intl.getCanonicalLocales(language.code); } catch { return false; }
  saveApplicationLanguage({ ...language, name: language.name.trim() });
  return true;
}

export function updateContentTranslation(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const entry = input as LocalizedContentEntry;
  if (!['rule', 'round', 'stage'].includes(entry.kind) || typeof entry.id !== 'string'
    || typeof entry.sourceText !== 'string' || !entry.sourceText.trim() || entry.sourceText.length > 500
    || !Array.isArray(entry.translations) || entry.translations.length === 0) return false;
  const catalog = findContentLocalization(true);
  const original = catalog.entries.find(e => e.kind === entry.kind && (entry.kind === 'rule' ? e.id === entry.id : e.sourceText === entry.sourceText))
    ?? (entry.kind !== 'rule' && entry.id === '' && entry.sourceText.length <= 140 ? { ...entry, translations: [] } : undefined);
  if (!original) return false;
  if (!original.translations.length && !entry.translations.some(t => t?.languageCode === 'en' && typeof t.value === 'string' && t.value.trim())) return false;
  const seen = new Set<string>();
  const placeholders = (value: string) => [...new Set([...value.matchAll(/\{\{(\w+)}}/g)].map(m => m[1]))].sort().join(',');
  for (const translation of entry.translations) {
    if (!translation || typeof translation.languageCode !== 'string' || !catalog.languages.some(l => l.code === translation.languageCode)
      || seen.has(translation.languageCode) || typeof translation.value !== 'string' || translation.value.length > (entry.kind === 'rule' ? 500 : 200)
      || (translation.languageCode === 'en' && !translation.value.trim())
      || (translation.value.trim() && placeholders(translation.value) !== placeholders(original.sourceText))) return false;
    seen.add(translation.languageCode);
  }
  saveContentTranslation({ ...original, translations: entry.translations.map(t => ({ ...t, value: t.value.trim() })) });
  return true;
}
