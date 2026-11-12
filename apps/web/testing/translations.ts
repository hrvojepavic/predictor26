import { registerLocaleData } from '@angular/common';
import croatianLocale from '@angular/common/locales/hr';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Language, LANGUAGE_STORAGE_KEY } from '@core/i18n/language.config';
import { TranslationService } from '@services/translation.service';
import { TranslationsProvider } from '@services/providers/translations.provider';
import english from '../public/i18n/en.json';
import croatian from '../public/i18n/hr.json';

export { english, croatian };
export const testTranslationsProvider = {
  provide: TranslationsProvider,
  useValue: { load: (language: Language) => of(language === Language.Croatian ? croatian : english) }
};

export async function initializeTestTranslations(): Promise<void> {
  registerLocaleData(croatianLocale);
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  await TestBed.inject(TranslationService).initialize();
}
