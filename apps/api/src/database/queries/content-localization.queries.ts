import { openDatabase } from '../index.js';
import { randomUUID } from 'node:crypto';
import type { ApplicationLanguage, ContentLocalizationResponse, CreateContentRuleRequest, LocalizedContentEntry } from '../../modules/content-localization/content-localization.interfaces.js';

export function insertContentRule(input: CreateContentRuleRequest): void {
  const db = openDatabase();
  try {
    db.transaction(() => {
      const key = `custom-${randomUUID()}`;
      const english = input.translations.find(t => t.languageCode === 'en')!.value;
      db.prepare(`INSERT INTO rule_templates(key, text_template, value_label, default_value, sort_order)
        SELECT ?, ?, ?, ?, COALESCE(MAX(sort_order), 0) + 1 FROM rule_templates`)
        .run(key, english, input.valueLabel ?? null, input.defaultValue ?? null);
      const insert = db.prepare('INSERT INTO rule_template_translations(template_key, language_code, text_template) VALUES (?, ?, ?)');
      for (const translation of input.translations) {
        if (translation.value) insert.run(key, translation.languageCode, translation.value);
      }
    })();
  } finally { db.close(); }
}

export function readContentLocalization(includeUnreleased = false): ContentLocalizationResponse {
  const db = openDatabase();
  try {
    const languages = db.prepare('SELECT code, name, is_enabled FROM application_languages ORDER BY code').all() as { code: string; name: string; is_enabled: number }[];
    const rules = db.prepare('SELECT key, text_template FROM rule_templates ORDER BY sort_order').all() as { key: string; text_template: string }[];
    const ruleTranslations = db.prepare('SELECT template_key, language_code, text_template FROM rule_template_translations').all() as { template_key: string; language_code: string; text_template: string }[];
    const wording = db.prepare('SELECT id, kind, source_text FROM competition_wording ORDER BY kind, id').all() as { id: number; kind: 'round' | 'stage'; source_text: string }[];
    const wordingTranslations = db.prepare('SELECT wording_id, language_code, text FROM competition_wording_translations').all() as { wording_id: number; language_code: string; text: string }[];
    const entries: LocalizedContentEntry[] = [
      ...rules.map(rule => ({ id: rule.key, kind: 'rule' as const, sourceText: rule.text_template,
        translations: ruleTranslations.filter(t => t.template_key === rule.key).map(t => ({ languageCode: t.language_code, value: t.text_template })) })),
      ...wording.map(word => ({ id: String(word.id), kind: word.kind, sourceText: word.source_text,
        translations: wordingTranslations.filter(t => t.wording_id === word.id).map(t => ({ languageCode: t.language_code, value: t.text })) }))
    ];
    // Imported labels without a configured definition remain visible in the editor.
    const imported = db.prepare(`SELECT DISTINCT 'stage' AS kind, stage AS source_text FROM matches WHERE (? = 1 OR released_for_predictions = 1)
      UNION SELECT DISTINCT 'round', round_label FROM matches WHERE (? = 1 OR released_for_predictions = 1)`)
      .all(Number(includeUnreleased), Number(includeUnreleased)) as { kind: 'round' | 'stage'; source_text: string }[];
    for (const word of imported) {
      if (!word.source_text || entries.some(e => e.kind === word.kind && matchesSource(e.sourceText, word.source_text))) continue;
      entries.push({ id: '', kind: word.kind, sourceText: word.source_text, translations: [{ languageCode: 'en', value: word.source_text }] });
    }
    return { languages: languages.map(l => ({ code: l.code, name: l.name, enabled: l.is_enabled === 1 })), entries };
  } finally { db.close(); }
}

function matchesSource(template: string, value: string): boolean {
  const pattern = template.split(/(\{\{\w+}})/).map(part => /^\{\{\w+}}$/.test(part) ? '.+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${pattern}$`).test(value);
}

export function writeApplicationLanguage(language: ApplicationLanguage): void {
  const db = openDatabase();
  try {
    db.prepare(`INSERT INTO application_languages(code, name, is_enabled) VALUES (?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET name = excluded.name, is_enabled = excluded.is_enabled`).run(language.code, language.name, Number(language.enabled));
  } finally { db.close(); }
}

export function writeContentTranslation(entry: LocalizedContentEntry): void {
  const db = openDatabase();
  try {
    db.transaction(() => {
      if (entry.kind === 'rule') {
        const save = db.prepare(`INSERT INTO rule_template_translations(template_key, language_code, text_template) VALUES (?, ?, ?)
          ON CONFLICT(template_key, language_code) DO UPDATE SET text_template = excluded.text_template`);
        const remove = db.prepare('DELETE FROM rule_template_translations WHERE template_key = ? AND language_code = ?');
        for (const translation of entry.translations) {
          if (translation.value) save.run(entry.id, translation.languageCode, translation.value);
          else remove.run(entry.id, translation.languageCode);
        }
      } else {
        db.prepare('INSERT OR IGNORE INTO competition_wording(kind, source_text) VALUES (?, ?)').run(entry.kind, entry.sourceText);
        const { id } = db.prepare('SELECT id FROM competition_wording WHERE kind = ? AND source_text = ?').get(entry.kind, entry.sourceText) as { id: number };
        const save = db.prepare(`INSERT INTO competition_wording_translations(wording_id, language_code, text) VALUES (?, ?, ?)
          ON CONFLICT(wording_id, language_code) DO UPDATE SET text = excluded.text`);
        const remove = db.prepare('DELETE FROM competition_wording_translations WHERE wording_id = ? AND language_code = ?');
        for (const translation of entry.translations) {
          if (translation.value) save.run(id, translation.languageCode, translation.value);
          else remove.run(id, translation.languageCode);
        }
      }
    })();
  } finally { db.close(); }
}
