import { DatePipe } from '@angular/common';
import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslationService } from '@services/translation.service';
import { DEFAULT_LANGUAGE, LANGUAGE_CONFIG } from '@core/i18n/language.config';

@Pipe({ name: 'localizedDate', pure: false })
export class LocalizedDatePipe implements PipeTransform {
  private readonly translations = inject(TranslationService);
  private readonly pipes = new Map<string, DatePipe>();

  transform(value: string | number | Date | null | undefined, format = 'mediumDate', timezone?: string): string | null {
    const selected = this.translations.language();
    const language = Object.hasOwn(LANGUAGE_CONFIG, selected) ? selected : DEFAULT_LANGUAGE;
    let pipe = this.pipes.get(language);
    if (!pipe) {
      pipe = new DatePipe(language);
      this.pipes.set(language, pipe);
    }
    return pipe.transform(value, format, timezone);
  }
}
