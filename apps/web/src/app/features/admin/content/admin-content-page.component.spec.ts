import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Language } from '@core/i18n/language.config';
import { ContentLocalizationApiProvider } from '@services/providers/content-localization-api.provider';
import type { ContentLocalizationResponse, CreateContentRuleRequest } from '@models/content-localization.models';
import { initializeTestTranslations, testTranslationsProvider } from '../../../../../testing/translations';
import { AdminContentPageComponent } from './admin-content-page.component';

describe('Admin content rule creation', () => {
  it('requires English and submits language drafts together, then resets the creation form', async () => {
    const catalog: ContentLocalizationResponse = {
      languages: [{ code: Language.English, name: 'English', enabled: true }, { code: Language.Croatian, name: 'Hrvatski', enabled: true }],
      entries: []
    };
    const createRule = vi.fn((input: CreateContentRuleRequest) => of({ ...catalog, entries: [
      { id: 'custom-test', kind: 'rule', sourceText: 'Play fairly.', translations: input.translations }
    ] }));
    TestBed.configureTestingModule({ providers: [provideRouter([]), testTranslationsProvider,
      { provide: ContentLocalizationApiProvider, useValue: { getAdminContent: () => of(catalog), createRule } }
    ] });
    await initializeTestTranslations();
    const fixture = TestBed.createComponent(AdminContentPageComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const form = root.querySelector<HTMLFormElement>('.new-rule')!;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const textarea = form.querySelector('textarea')!;
    const tabs = form.querySelectorAll<HTMLButtonElement>('.languages button');
    expect(submit.disabled).toBe(true);
    textarea.value = 'Play fairly.'; textarea.dispatchEvent(new Event('input'));
    tabs[1].click(); await fixture.whenStable();
    textarea.value = 'Igrajte pošteno.'; textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(submit.disabled).toBe(false);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(createRule).toHaveBeenCalledWith({ translations: [
      { languageCode: Language.English, value: 'Play fairly.' },
      { languageCode: Language.Croatian, value: 'Igrajte pošteno.' }
    ], valueLabel: '', defaultValue: '' });
    expect(textarea.value).toBe('');
    expect(submit.disabled).toBe(true);
    expect(root.querySelectorAll('article')).toHaveLength(1);
  });
});
