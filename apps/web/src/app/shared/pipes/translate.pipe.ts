import { inject, Pipe, PipeTransform } from '@angular/core';
import type { TranslationKey, TranslationParams } from '@models/translation.models';
import { TranslationService } from '@services/translation.service';

// Re-evaluate when the language changes even if the translation key stays the same.
@Pipe({ name: 'translate', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly translations = inject(TranslationService);

  transform(key: TranslationKey, params?: TranslationParams): string {
    return this.translations.translate(key, params);
  }
}
