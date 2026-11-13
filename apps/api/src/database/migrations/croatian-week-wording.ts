import type Database from 'better-sqlite3';

export function migrateCroatianWeekWording(db: Database.Database): void {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM app_metadata WHERE key = 'croatian_week_wording_v1'").get()) return;
    db.prepare(`UPDATE competition_wording_translations SET text = 'Tjedan {{number}}'
      WHERE language_code = 'hr' AND text = '{{number}}. kolo'
        AND wording_id IN (SELECT id FROM competition_wording WHERE kind = 'round' AND source_text = 'Week {{number}}')`).run();
    db.prepare("INSERT INTO app_metadata(key, value) VALUES ('croatian_week_wording_v1', '1')").run();
  })();
}
