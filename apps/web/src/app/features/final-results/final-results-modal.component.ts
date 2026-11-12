import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';

import { FinalResults, FinalResultsWinner } from '@services/final-results.service';

@Component({
  selector: 'app-final-results-modal',
  imports: [TranslatePipe, DecimalPipe],
  templateUrl: './final-results-modal.component.html',
  styleUrl: './final-results-modal.component.scss'
})
export class FinalResultsModalComponent {
  private readonly translations = inject(TranslationService);
  readonly results = input.required<FinalResults>();
  readonly closeModal = output<void>();

  protected readonly podiumWinners = computed(() => {
    const winners = this.results().winners;

    return [findWinner(winners, 2), findWinner(winners, 1), findWinner(winners, 3)].filter(
      (winner): winner is FinalResultsWinner => winner !== null
    );
  });

  protected readonly poolLabel = computed(() => this.formatCurrency(this.results().totalPrizePool));
  protected readonly sectionLabel = computed(() => (this.results().isCompetitionFinished ? this.translations.translate("ui.competition_complete") : this.translations.translate("ui.as_it_stands")));
  protected readonly title = computed(() => {
    const results = this.results();

    return results.isCompetitionFinished ? this.translations.translate("ui.final_rankings") : this.translations.translate('ui.rankings_after_p0', { p0: results.roundLabel ?? this.translations.translate('ui.current_week') });
  });

  protected formatCurrency(value: number): string {
    return new Intl.NumberFormat(this.translations.language(), {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: value % 1 === 0 ? 0 : 2
    }).format(value);
  }

  protected placeLabel(place: FinalResultsWinner['place']): string {
    return this.translations.translate('ordinal.' + ({ 1: 'one', 2: 'two', 3: 'three' } as Record<number, string>)[place], { count: place });
  }
}

function findWinner(winners: readonly FinalResultsWinner[], place: FinalResultsWinner['place']): FinalResultsWinner | null {
  return winners.find((winner) => winner.place === place) ?? null;
}
