import { inject, Pipe, PipeTransform } from '@angular/core';
import { ContentLocalizationService } from '@services/content-localization.service';
import type { LocalizedContentEntry } from '@models/content-localization.models';

@Pipe({ name: 'contentText', pure: false })
export class ContentTextPipe implements PipeTransform {
  private readonly content = inject(ContentLocalizationService);
  transform(source: string | null | undefined, kind: LocalizedContentEntry['kind'] = 'round'): string {
    return this.content.text(source, kind);
  }
}
