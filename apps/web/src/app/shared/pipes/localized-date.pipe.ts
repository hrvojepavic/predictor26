import { DatePipe } from '@angular/common';
import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslationService } from '@services/translation.service';
import { Language } from '@core/i18n/language.config';

@Pipe({ name: 'localizedDate', pure: false })
export class LocalizedDatePipe implements PipeTransform {
  private readonly translations = inject(TranslationService);
  private readonly pipes = new Map<Language, DatePipe>();

  transform(value: string | number | Date | null | undefined, format = 'mediumDate', timezone?: string): string | null {
    const language = this.translations.language();
    let pipe = this.pipes.get(language);
    if (!pipe) {
      pipe = new DatePipe(language);
      this.pipes.set(language, pipe);
    }
    return pipe.transform(value, format, timezone);
  }
}
