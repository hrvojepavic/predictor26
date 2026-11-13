import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Language, LANGUAGE_STORAGE_KEY } from '@core/i18n/language.config';
import type { ContentLocalizationResponse } from '@models/content-localization.models';
import { ContentLocalizationService } from './content-localization.service';
import { TranslationService } from './translation.service';

const catalog: ContentLocalizationResponse = {
  languages: [
    { code: Language.English, name: 'English', enabled: true },
    { code: Language.Croatian, name: 'Hrvatski', enabled: true },
    { code: 'de', name: 'Deutsch', enabled: true }
  ],
  entries: [
    { id: '1', kind: 'round', sourceText: 'Week {{number}}', translations: [
      { languageCode: Language.English, value: 'Week {{number}}' }, { languageCode: Language.Croatian, value: 'Tjedan {{number}}' }
    ] },
    { id: '2', kind: 'round', sourceText: 'Week 7', translations: [{ languageCode: Language.Croatian, value: 'Posebno kolo' }] },
    { id: '3', kind: 'stage', sourceText: 'League', translations: [{ languageCode: Language.Croatian, value: 'Liga' }] }
  ]
};

describe('Database content localization', () => {
  let http: HttpTestingController;
  let content: ContentLocalizationService;
  let translations: TranslationService;
  beforeEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    content = TestBed.inject(ContentLocalizationService);
    translations = TestBed.inject(TranslationService);
  });
  afterEach(() => { http.verify(); localStorage.removeItem(LANGUAGE_STORAGE_KEY); });

  async function initialize() {
    const pending = content.initialize();
    http.expectOne('/i18n/en.json').flush({ greeting: 'Hello' });
    await vi.waitFor(() => http.expectOne('/api/content-localization').flush(catalog));
    await pending;
  }

  it('switches already loaded DB values without requesting content again', async () => {
    await initialize();
    expect(content.text('Week 12')).toBe('Week 12');
    const switchLanguage = translations.setLanguage(Language.Croatian);
    http.expectOne('/i18n/hr.json').flush({ greeting: 'Pozdrav' });
    await switchLanguage;
    expect(content.text('Week 12')).toBe('Tjedan 12');
    expect(content.text('Week 7')).toBe('Posebno kolo');
    expect(content.text('League', 'stage')).toBe('Liga');
    expect(content.text('Unknown round')).toBe('Unknown round');
    expect(content.localize([{ languageCode: Language.English, value: 'Fallback rule' }])).toBe('Fallback rule');
    await translations.setLanguage(Language.English);
    expect(content.text('Week 12')).toBe('Week 12');
    http.expectNone('/api/content-localization');
  });

  it('restores a DB-added language and falls back to English interface text', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    await initialize();
    expect(translations.language()).toBe('de');
    expect(translations.translate('greeting')).toBe('Hello');
    expect(content.localize([{ languageCode: 'de', value: 'Regel' }, { languageCode: Language.English, value: 'Rule' }])).toBe('Regel');
    await content.apply({ ...catalog, languages: catalog.languages.map(l => l.code === 'de' ? { ...l, enabled: false } : l) });
    expect(translations.language()).toBe(Language.English);
    expect(await translations.setLanguage('de')).toBe(false);
  });
});
