import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AVAILABLE_LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, Language } from '@core/i18n/language.config';
import type { TranslationDictionary, TranslationKey, TranslationParams } from '@models/translation.models';
import { TranslationsProvider } from '@services/providers/translations.provider';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly document = inject(DOCUMENT);
  private readonly provider = inject(TranslationsProvider);
  private readonly selectedLanguage = signal<Language>(DEFAULT_LANGUAGE);
  private readonly dictionaries = signal<Partial<Record<Language, TranslationDictionary>>>({});
  private readonly pending = new Map<Language, Promise<void>>();
  private initialization?: Promise<void>;
  private selectionVersion = 0;
  readonly language = this.selectedLanguage.asReadonly();

  constructor() {
    this.document.documentElement.lang = this.language();
  }

  initialize(): Promise<void> {
    return this.initialization ??= this.initializeLanguage();
  }

  private async initializeLanguage(): Promise<void> {
    await this.load(DEFAULT_LANGUAGE);
    const saved = this.readLanguage();
    if (saved !== DEFAULT_LANGUAGE) {
      await this.setLanguage(saved);
    }
  }

  async setLanguage(language: Language): Promise<boolean> {
    const version = ++this.selectionVersion;
    try {
      await this.load(language);
    } catch {
      return false;
    }
    // Only the latest selection may activate, regardless of response order.
    if (version !== this.selectionVersion) return false;
    this.selectedLanguage.set(language);
    this.document.documentElement.lang = language;
    try {
      this.document.defaultView?.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Language switching still works when browser storage is unavailable.
    }
    return true;
  }

  translate(key: TranslationKey, params: TranslationParams = {}): string {
    const dictionaries = this.dictionaries();
    const current = dictionaries[this.language()];
    const fallback = dictionaries[DEFAULT_LANGUAGE];
    const template = (current && Object.hasOwn(current, key) ? current[key] : undefined)
      ?? (fallback && Object.hasOwn(fallback, key) ? fallback[key] : undefined) ?? key;
    return template.replace(/\{\{\s*(\w+)\s*}}/g, (placeholder, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
    );
  }

  private load(language: Language): Promise<void> {
    if (this.dictionaries()[language]) return Promise.resolve();
    const pending = this.pending.get(language);
    if (pending) return pending;
    const request = firstValueFrom(this.provider.load(language))
      .then(dictionary => {
        this.dictionaries.update(current => ({ ...current, [language]: dictionary }));
      })
      .finally(() => this.pending.delete(language));
    this.pending.set(language, request);
    return request;
  }

  private readLanguage(): Language {
    try {
      const saved = this.document.defaultView?.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      return AVAILABLE_LANGUAGES.find(option => option.language === saved)?.language ?? DEFAULT_LANGUAGE;
    } catch {
      return DEFAULT_LANGUAGE;
    }
  }
}
