import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map } from 'rxjs';
import { LANGUAGE_CONFIG, Language } from '@core/i18n/language.config';
import type { TranslationDictionary } from '@models/translation.models';

@Injectable({ providedIn: 'root' })
export class TranslationsProvider {
  private readonly http = inject(HttpClient);

  load(language: Language) {
    return this.http.get<unknown>(LANGUAGE_CONFIG[language].url).pipe(map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.values(value).some(text => typeof text !== 'string')) {
        throw new Error('Invalid translation dictionary');
      }
      return value as TranslationDictionary;
    }));
  }
}
