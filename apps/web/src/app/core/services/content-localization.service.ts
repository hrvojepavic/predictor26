import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_LANGUAGE } from '@core/i18n/language.config';
import type { ContentLocalizationResponse, LocalizedContentEntry, LocalizedString } from '@models/content-localization.models';
import { TranslationService } from './translation.service';
import { ContentLocalizationApiProvider } from './providers/content-localization-api.provider';

@Injectable({ providedIn: 'root' })
export class ContentLocalizationService {
  private readonly api = inject(ContentLocalizationApiProvider);
  private readonly translations = inject(TranslationService);
  private readonly state = signal<ContentLocalizationResponse>({ languages: [], entries: [] });
  readonly languages = computed(() => this.state().languages);
  readonly entries = computed(() => this.state().entries);
  private readonly definitions = computed(() => this.entries().map(entry => {
    const names: string[] = [];
    const pattern = entry.sourceText.split(/(\{\{\w+}})/).map(part => {
      const match = /^\{\{(\w+)}}$/.exec(part);
      if (match) { names.push(match[1]); return match[1] === 'number' ? '(\\d+)' : '(.+)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return { entry, names, pattern: new RegExp(`^${pattern}$`) };
  }));

  async initialize(): Promise<void> {
    await this.translations.initialize();
    await this.apply(await firstValueFrom(this.api.getContent()));
  }

  async apply(content: ContentLocalizationResponse): Promise<void> {
    this.state.set(content);
    await this.translations.configureLanguages(content.languages);
  }

  localize(values: readonly LocalizedString[], fallback = ''): string {
    return values.find(value => value.languageCode === this.translations.language())?.value
      || values.find(value => value.languageCode === DEFAULT_LANGUAGE)?.value || fallback;
  }

  text(source: string | null | undefined, kind: LocalizedContentEntry['kind'] = 'round'): string {
    if (!source) return '';
    const definitions = this.definitions();
    const exact = definitions.find(({ entry }) => entry.kind === kind && (kind === 'rule' ? entry.id === source : entry.sourceText === source));
    if (exact) return this.localize(exact.entry.translations, exact.entry.sourceText);
    // Numbered rounds use templates stored in the DB; no translated wording is hardcoded here.
    for (const definition of definitions) {
      if (definition.entry.kind !== kind || !definition.names.length) continue;
      const match = definition.pattern.exec(source);
      if (!match) continue;
      const params = Object.fromEntries(definition.names.map((name, index) => [name, match[index + 1]]));
      return this.localize(definition.entry.translations, source).replace(/\{\{(\w+)}}/g, (placeholder, name: string) => params[name] ?? placeholder);
    }
    return source;
  }
}
