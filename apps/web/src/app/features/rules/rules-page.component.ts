import type { LocalizedString } from '@models/content-localization.models';
import { LocalizedTextPipe } from '@shared/pipes/localized-text.pipe';
import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AppStateService } from '@core/state/app-state.service';
import { CompetitionsApiProvider } from '@services/providers/competitions-api.provider';

@Component({
  selector: 'app-rules-page',
  imports: [LocalizedTextPipe, TranslatePipe, RouterLink],
  templateUrl: './rules-page.component.html',
  styleUrl: './rules-page.component.scss'
})
export class RulesPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly appState = inject(AppStateService);
  private readonly competitionsApi = inject(CompetitionsApiProvider);

  protected readonly activeCompetition = this.appState.activeCompetition;
  protected readonly rules = signal<LocalizedString[][]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.competitionsApi.getCompetitionRules().subscribe({
      next: ({ rules }) => {
        this.rules.set(rules);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.competition_rules_could_not_be_loaded"));
        this.loading.set(false);
      }
    });
  }
}
