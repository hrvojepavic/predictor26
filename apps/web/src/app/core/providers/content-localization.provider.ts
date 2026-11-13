import { inject, provideAppInitializer } from '@angular/core';
import { ContentLocalizationService } from '@services/content-localization.service';

export function provideContentLocalization() {
  return provideAppInitializer(() => inject(ContentLocalizationService).initialize());
}
