import { inject, provideAppInitializer } from '@angular/core';
import { TranslationService } from '@services/translation.service';

export function provideTranslations() {
  return provideAppInitializer(() => inject(TranslationService).initialize());
}
