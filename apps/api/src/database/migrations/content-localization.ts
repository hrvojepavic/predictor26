import type Database from 'better-sqlite3';

// Stable source identifiers remain separate from editable display translations.
export function migrateContentLocalization(db: Database.Database): void {
  if (db.prepare("SELECT 1 FROM app_metadata WHERE key = 'content_localization_v1'").get()) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS application_languages (
        code TEXT PRIMARY KEY CHECK(length(code) BETWEEN 2 AND 35),
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
        is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS rule_template_translations (
        template_key TEXT NOT NULL REFERENCES rule_templates(key) ON DELETE CASCADE,
        language_code TEXT NOT NULL REFERENCES application_languages(code) ON DELETE RESTRICT,
        text_template TEXT NOT NULL CHECK(length(text_template) BETWEEN 1 AND 500),
        PRIMARY KEY (template_key, language_code)
      );
      CREATE TABLE IF NOT EXISTS competition_wording (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK(kind IN ('round', 'stage')),
        source_text TEXT NOT NULL CHECK(length(source_text) BETWEEN 1 AND 140),
        UNIQUE(kind, source_text)
      );
      CREATE TABLE IF NOT EXISTS competition_wording_translations (
        wording_id INTEGER NOT NULL REFERENCES competition_wording(id) ON DELETE CASCADE,
        language_code TEXT NOT NULL REFERENCES application_languages(code) ON DELETE RESTRICT,
        text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 200),
        PRIMARY KEY (wording_id, language_code)
      );
    `);
    db.prepare('INSERT OR IGNORE INTO application_languages(code, name) VALUES (?, ?)').run('en', 'English');
    db.prepare('INSERT OR IGNORE INTO application_languages(code, name) VALUES (?, ?)').run('hr', 'Hrvatski');
    db.exec(`INSERT OR IGNORE INTO rule_template_translations(template_key, language_code, text_template)
      SELECT key, 'en', text_template FROM rule_templates`);
    const rules: Record<string, string> = {
      'exact-score': 'Točno pogođen rezultat donosi 1 bod.',
      'odds-outcome': 'Točno pogođen ishod utakmice donosi bodove jednake odabranom koeficijentu.',
      'regular-time': 'Računa se samo rezultat u regularnom vremenu; produžeci i jedanaesterci se ne računaju.',
      'accumulate-points': 'Bodovi se zbrajaju nakon svake utakmice tijekom natjecanja.',
      'rank-total-points': 'Korisnici se prvenstveno rangiraju prema ukupnom broju bodova.',
      'winner-tiebreaker': 'Pogođeni pobjednik natjecanja drugi je kriterij rangiranja u slučaju jednakog broja bodova.',
      'buy-in': 'Ulog iznosi {{value}} po igraču.',
      'prize-split': 'Nagradni fond dijeli se: 60% za prvo, 30% za drugo i 10% za treće mjesto.',
      'split-ties': 'Ako su korisnici i dalje izjednačeni, nagradni fond dijeli se prema postavljenoj raspodjeli nagrada.',
      'round-deadline': 'Prognoze se moraju predati prije prve utakmice svakog kola.',
      'visible-after-deadline': 'Nakon isteka roka svi korisnici mogu vidjeti sve prognoze za to kolo.'
    };
    for (const [key, text] of Object.entries(rules)) {
      db.prepare(`INSERT OR IGNORE INTO rule_template_translations
        SELECT key, 'hr', ? FROM rule_templates WHERE key = ?`).run(text, key);
    }
    const wording: Array<[string, string, string]> = [
      ['round', 'Week {{number}}', 'Tjedan {{number}}'],
      ['round', 'Round {{number}}', '{{number}}. kolo'],
      ['round', 'Group stage - Round {{number}}', 'Grupna faza - {{number}}. kolo'],
      ['round', 'Group {{group}}', 'Skupina {{group}}'],
      ['round', 'Round of 32', 'Šesnaestina finala'],
      ['round', 'Round of 16', 'Osmina finala'],
      ['round', 'Quarter-finals', 'Četvrtfinale'],
      ['round', 'Semi-finals', 'Polufinale'],
      ['round', 'Third-place play-off', 'Utakmica za treće mjesto'],
      ['round', 'Final', 'Finale'],
      ['stage', 'League', 'Liga'],
      ['stage', 'league', 'Liga'],
      ['stage', 'Group stage', 'Grupna faza'],
      ['stage', 'Knockout stage', 'Nokaut faza']
    ];
    for (const [kind, source, croatian] of wording) {
      db.prepare('INSERT OR IGNORE INTO competition_wording(kind, source_text) VALUES (?, ?)').run(kind, source);
      const { id } = db.prepare('SELECT id FROM competition_wording WHERE kind = ? AND source_text = ?').get(kind, source) as { id: number };
      const insert = db.prepare('INSERT OR IGNORE INTO competition_wording_translations(wording_id, language_code, text) VALUES (?, ?, ?)');
      insert.run(id, 'en', source);
      insert.run(id, 'hr', croatian);
    }
    db.prepare("INSERT INTO app_metadata(key, value) VALUES ('content_localization_v1', '1')").run();
  })();
}
