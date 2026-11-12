import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Component, computed, inject } from '@angular/core';

import { MatchSortMode, MatchSortPreferenceService } from '@core/state/match-sort-preference.service';

@Component({
  imports: [TranslatePipe],
  selector: 'app-match-sort-menu',
  templateUrl: './match-sort-menu.component.html',
  styleUrl: './match-sort-menu.component.scss'
})
export class MatchSortMenuComponent {
  private readonly translations = inject(TranslationService);
  private readonly sortPreference = inject(MatchSortPreferenceService);

  protected readonly sortMode = this.sortPreference.sortMode;
  protected readonly currentLabel = computed(() => sortLabel(this.sortMode(), this.translations));
  protected readonly alternateMode = computed<MatchSortMode>(() => (this.sortMode() === 'rounds' ? 'groups' : 'rounds'));
  protected readonly alternateLabel = computed(() => sortLabel(this.alternateMode(), this.translations));

  protected selectMode(mode: MatchSortMode, event: MouseEvent): void {
    this.sortPreference.setSortMode(mode);
    (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  }
}

function sortLabel(mode: MatchSortMode, translations: TranslationService): string {
  return mode === 'rounds' ? translations.translate("ui.rounds") : translations.translate("ui.groups");
}
