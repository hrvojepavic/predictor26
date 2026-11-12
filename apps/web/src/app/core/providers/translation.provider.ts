import { registerLocaleData } from '@angular/common';
import croatianLocale from '@angular/common/locales/hr';
import { inject, provideAppInitializer } from '@angular/core';
import { TranslationService } from '@services/translation.service';

export function provideTranslations() {
  return provideAppInitializer(() => {
    registerLocaleData(croatianLocale);
    return inject(TranslationService).initialize();
  });
}
