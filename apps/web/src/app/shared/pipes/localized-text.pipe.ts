import { inject, Pipe, PipeTransform } from '@angular/core';
import { ContentLocalizationService } from '@services/content-localization.service';
import type { LocalizedString } from '@models/content-localization.models';

@Pipe({ name: 'localizedText', pure: false })
export class LocalizedTextPipe implements PipeTransform {
  private readonly content = inject(ContentLocalizationService);
  transform(values: readonly LocalizedString[]): string { return this.content.localize(values); }
}
