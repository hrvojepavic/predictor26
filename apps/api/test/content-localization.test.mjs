import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import Database from 'better-sqlite3';

const directory = mkdtempSync(join(tmpdir(), 'predictor26-localization-'));
process.env.DATABASE_PATH = join(directory, 'test.sqlite');
process.env.NODE_ENV = 'test';
process.env.AUTH_TOKEN_SECRET = 'localization-tests';
const { openDatabase } = await import('../dist/database/index.js');
const service = await import('../dist/modules/content-localization/content-localization.service.js');
const { getDefaultCompetitionRules } = await import('../dist/modules/competitions/competitions.service.js');
const { contentLocalizationRoutes } = await import('../dist/modules/content-localization/content-localization.routes.js');
const { createAuthToken } = await import('../dist/shared/utils/auth-token.js');
const db = openDatabase();
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test('seeds linked languages, rule translations and numbered round definitions', () => {
  const catalog = service.getContentLocalization();
  assert.deepEqual(catalog.languages.map(language => language.code), ['en', 'hr']);
  assert.equal(catalog.entries.filter(entry => entry.kind === 'rule').length, 11);
  const week = catalog.entries.find(entry => entry.sourceText === 'Week {{number}}');
  assert.equal(week.translations.find(t => t.languageCode === 'hr').value, 'Tjedan {{number}}');
  assert.throws(() => db.prepare('INSERT INTO rule_template_translations VALUES (?, ?, ?)').run('unknown-rule', 'hr', 'Text'), /FOREIGN KEY/);
});

test('corrects the old Croatian week default once while preserving custom text and rounds', async () => {
  const { migrateCroatianWeekWording } = await import('../dist/database/migrations/croatian-week-wording.js');
  for (const original of ['{{number}}. kolo', 'Moj tjedan {{number}}']) {
    const legacy = new Database(':memory:');
    try {
      legacy.exec(`CREATE TABLE app_metadata(key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE competition_wording(id INTEGER PRIMARY KEY, kind TEXT, source_text TEXT);
        CREATE TABLE competition_wording_translations(wording_id INTEGER, language_code TEXT, text TEXT);
        INSERT INTO competition_wording VALUES (1, 'round', 'Week {{number}}'), (2, 'round', 'Round {{number}}');
        INSERT INTO competition_wording_translations VALUES (2, 'hr', '{{number}}. kolo');`);
      legacy.prepare('INSERT INTO competition_wording_translations VALUES (1, ?, ?)').run('hr', original);
      migrateCroatianWeekWording(legacy);
      assert.equal(legacy.prepare('SELECT text FROM competition_wording_translations WHERE wording_id = 1').get().text,
        original === '{{number}}. kolo' ? 'Tjedan {{number}}' : original);
      assert.equal(legacy.prepare('SELECT text FROM competition_wording_translations WHERE wording_id = 2').get().text, '{{number}}. kolo');
      legacy.prepare('UPDATE competition_wording_translations SET text = ? WHERE wording_id = 1').run('{{number}}. kolo');
      migrateCroatianWeekWording(legacy);
      assert.equal(legacy.prepare('SELECT text FROM competition_wording_translations WHERE wording_id = 1').get().text, '{{number}}. kolo');
    } finally { legacy.close(); }
  }
});

test('adds languages globally and protects English fallback', () => {
  assert.equal(service.updateApplicationLanguage({ code: 'de', name: 'Deutsch', enabled: true }), true);
  assert.equal(service.updateApplicationLanguage({ code: 'en', name: 'English', enabled: false }), false);
  assert.equal(service.updateApplicationLanguage({ code: '../de', name: 'Invalid', enabled: true }), false);
});

test('validates placeholders and unknown language codes without partial saves', () => {
  const rule = service.getContentLocalization().entries.find(entry => entry.id === 'buy-in');
  assert.equal(service.updateContentTranslation({ ...rule, translations: [{ languageCode: 'hr', value: 'Ulog je bez vrijednosti.' }] }), false);
  assert.equal(service.updateContentTranslation({ ...rule, translations: [{ languageCode: 'en', value: '' }] }), false);
  assert.equal(service.updateContentTranslation({ ...rule, translations: [{ languageCode: 'de', value: 'Einsatz: {{value}}.' }, { languageCode: 'zz', value: '{{value}}' }] }), false);
  assert.equal(service.getContentLocalization().entries.find(entry => entry.id === 'buy-in').translations.some(t => t.languageCode === 'de'), false);
  assert.equal(service.updateContentTranslation({ ...rule, translations: [{ languageCode: 'de', value: 'Einsatz: {{value}}.' }] }), true);
});

test('rule responses contain all variants and insert the same untranslated value', async () => {
  const { rules } = await getDefaultCompetitionRules();
  const buyIn = rules.find(variants => variants.some(t => t.languageCode === 'de'));
  assert.equal(buyIn.find(t => t.languageCode === 'en').value, 'Buy-in is 25 EUR per player.');
  assert.equal(buyIn.find(t => t.languageCode === 'hr').value, 'Ulog iznosi 25 EUR po igraču.');
  assert.equal(buyIn.find(t => t.languageCode === 'de').value, 'Einsatz: 25 EUR.');
});

test('saves new wording and preserves edits, disabled languages and cleared variants on restart', () => {
  assert.equal(service.updateContentTranslation({ id: '', kind: 'stage', sourceText: 'Custom stage', translations: [{ languageCode: 'en', value: 'Custom stage' }, { languageCode: 'hr', value: 'Posebna faza' }] }), true);
  const rule = service.getContentLocalization().entries.find(entry => entry.id === 'exact-score');
  assert.equal(service.updateContentTranslation({ ...rule, translations: [{ languageCode: 'en', value: 'Edited rule.' }, { languageCode: 'hr', value: '' }] }), true);
  assert.equal(service.updateApplicationLanguage({ code: 'de', name: 'Deutsch', enabled: false }), true);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', "const {openDatabase}=await import('./dist/database/index.js'); openDatabase().close();"], {
    cwd: new URL('..', import.meta.url), env: process.env, encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr);
  const catalog = service.getContentLocalization();
  const saved = catalog.entries.find(entry => entry.id === 'exact-score');
  assert.equal(saved.translations.find(t => t.languageCode === 'en').value, 'Edited rule.');
  assert.equal(saved.translations.some(t => t.languageCode === 'hr'), false);
  assert.equal(catalog.languages.find(l => l.code === 'de').enabled, false);
});

test('creates translated rules with optional values without enabling them in competitions', async () => {
  assert.equal(service.createContentRule({ translations: [{ languageCode: 'hr', value: 'Samo hrvatski' }] }), false);
  assert.equal(service.createContentRule({ translations: [{ languageCode: 'en', value: 'Limit {{value}}' }] }), false);
  assert.equal(service.createContentRule({ translations: [{ languageCode: 'en', value: 'Invalid {{other}}' }] }), false);
  assert.equal(service.createContentRule({ translations: [{ languageCode: 'en', value: 'Limit {{value}}' }, { languageCode: 'hr', value: 'Bez vrijednosti' }], valueLabel: 'Limit' }), false);
  assert.equal(service.createContentRule({ translations: [{ languageCode: 'en', value: 'Play fairly.' }, { languageCode: 'hr', value: 'Igrajte pošteno.' }] }), true);
  assert.equal(service.createContentRule({ translations: [{ languageCode: 'en', value: 'Limit: {{value}}.' }, { languageCode: 'hr', value: 'Ograničenje: {{value}}.' }], valueLabel: 'Limit', defaultValue: '5' }), true);
  const { getAdminRuleTemplates } = await import('../dist/modules/competitions/competitions.service.js');
  const { templates } = await getAdminRuleTemplates();
  const rule = templates.find(t => t.textTemplate === 'Limit: {{value}}.');
  assert.equal(rule.valueLabel, 'Limit');
  assert.equal(rule.defaultValue, '5');
  assert.equal(service.getContentLocalization().entries.find(e => e.id === rule.key).translations.length, 2);
  db.prepare("INSERT INTO competitions(name,slug) VALUES ('Custom rules test','custom-rules-test')").run();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', "const {openDatabase}=await import('./dist/database/index.js'); openDatabase().close();"], {
    cwd: new URL('..', import.meta.url), env: process.env, encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM competition_rules WHERE template_key LIKE 'custom-%'").get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rule_template_translations WHERE template_key = ?').get(rule.key).count, 2);
});

test('only super admins can change global languages and translations', async () => {
  db.prepare("INSERT INTO users(id,username,first_name,last_name,password_hash,role) VALUES (900,'editor','Test','User','unused','admin')").run();
  const app = express(); app.use(express.json()); app.use('/api', contentLocalizationRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(`${base}/content-localization`)).status, 200);
    assert.equal((await fetch(`${base}/admin/languages`, { method: 'PUT' })).status, 401);
    const token = createAuthToken({ userId: 900, username: 'editor', role: 'admin' });
    assert.equal((await fetch(`${base}/admin/content-translations`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } })).status, 403);
    assert.equal((await fetch(`${base}/admin/content-localization`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
    assert.equal((await fetch(`${base}/admin/content-rules`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 403);
    db.prepare("INSERT INTO users(id,username,first_name,last_name,password_hash,role) VALUES (901,'owner','Test','Owner','unused','super_admin')").run();
    const ownerToken = createAuthToken({ userId: 901, username: 'owner', role: 'super_admin' });
    const saved = await fetch(`${base}/admin/languages`, {
      method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'fr', name: 'Français', enabled: false })
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).languages.find(language => language.code === 'fr').enabled, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
