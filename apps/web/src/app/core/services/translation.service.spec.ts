import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DEFAULT_LANGUAGE, LANGUAGE_CONFIG, LANGUAGE_STORAGE_KEY, Language } from '@core/i18n/language.config';
import { TranslationService } from './translation.service';
import { LanguageSwitcherComponent } from '@shared/components/language-switcher/language-switcher.component';

describe('Translation loading and preferences', () => {
  let http: HttpTestingController;
  let service: TranslationService;
  const english = { 'navigation.title': 'Navigation', 'language.label': 'Language', greeting: 'Hello {{name}}' };
  const croatian = { 'navigation.title': 'Navigacija', 'language.label': 'Jezik' };
  const url = (language: Language) => LANGUAGE_CONFIG[language].url;

  beforeEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(TranslationService);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    document.documentElement.lang = DEFAULT_LANGUAGE;
  });

  async function initialize() {
    const ready = service.initialize();
    http.expectOne(url(DEFAULT_LANGUAGE)).flush(english);
    await ready;
  }

  it('loads the default before initialization completes and ignores invalid preferences', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'unsupported');
    await initialize();
    expect(service.language()).toBe(DEFAULT_LANGUAGE);
    expect(service.translate('navigation.title')).toBe('Navigation');
    await service.initialize();
    http.expectNone(url(DEFAULT_LANGUAGE));
  });

  it('waits for a saved language at startup', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, Language.Croatian);
    const ready = service.initialize();
    http.expectOne(url(DEFAULT_LANGUAGE)).flush(english);
    await vi.waitFor(() => http.expectOne(url(Language.Croatian)).flush(croatian));
    await ready;
    expect(service.language()).toBe(Language.Croatian);
    expect(document.documentElement.lang).toBe(Language.Croatian);
  });

  it('retains the default if the saved dictionary fails to load', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, Language.Croatian);
    const ready = service.initialize();
    http.expectOne(url(DEFAULT_LANGUAGE)).flush(english);
    await vi.waitFor(() => http.expectOne(url(Language.Croatian)).flush('Unavailable', { status: 503, statusText: 'Unavailable' }));
    await ready;
    expect(service.translate('navigation.title')).toBe('Navigation');
    expect(service.language()).toBe(DEFAULT_LANGUAGE);
  });

  it('rejects startup when the required default dictionary is unavailable', async () => {
    const ready = service.initialize();
    const rejection = expect(ready).rejects.toBeDefined();
    http.expectOne(url(DEFAULT_LANGUAGE)).flush('Missing', { status: 404, statusText: 'Not found' });
    await rejection;
  });

  it('updates selection and attributes only after loading, and caches dictionaries', async () => {
    await initialize();
    const fixture = TestBed.createComponent(LanguageSwitcherComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll('button');
    buttons[1].click();
    expect(service.language()).toBe(DEFAULT_LANGUAGE);
    http.expectOne(url(Language.Croatian)).flush(croatian);
    await fixture.whenStable();
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Jezik');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(Language.Croatian);
    expect(service.translate('greeting', { name: 'Ana' })).toBe('Hello Ana');
    expect(service.translate('unknown')).toBe('unknown');
    await service.setLanguage(DEFAULT_LANGUAGE);
    await service.setLanguage(Language.Croatian);
    http.expectNone(url(Language.Croatian));
  });

  it('preserves language on load errors and allows retry', async () => {
    await initialize();
    const failed = service.setLanguage(Language.Croatian);
    http.expectOne(url(Language.Croatian)).flush({ bad: 123 });
    expect(await failed).toBe(false);
    expect(service.language()).toBe(DEFAULT_LANGUAGE);
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    const retry = service.setLanguage(Language.Croatian);
    http.expectOne(url(Language.Croatian)).flush(croatian);
    expect(await retry).toBe(true);
  });

  it('deduplicates pending requests and honors the latest selection', async () => {
    await initialize();
    const first = service.setLanguage(Language.Croatian);
    const second = service.setLanguage(Language.Croatian);
    const last = service.setLanguage(DEFAULT_LANGUAGE);
    http.expectOne(url(Language.Croatian)).flush(croatian);
    await Promise.all([first, second, last]);
    expect(service.language()).toBe(DEFAULT_LANGUAGE);
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(DEFAULT_LANGUAGE);
  });

  it('works when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    await initialize();
    const switched = service.setLanguage(Language.Croatian);
    http.expectOne(url(Language.Croatian)).flush(croatian);
    expect(await switched).toBe(true);
    expect(service.translate('navigation.title')).toBe('Navigacija');
  });
});
