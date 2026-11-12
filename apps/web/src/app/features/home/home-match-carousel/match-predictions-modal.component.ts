import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { DecimalPipe } from '@angular/common';
import { inject, Component, computed, input, output } from '@angular/core';

import { LeaderboardDayMatch, LeaderboardMatchPredictionsResponse, LeaderboardMatchPredictionUser } from '@models/leaderboard.models';
import { TeamNameComponent } from '@shared/components/team-name/team-name.component';
import { getPredictionPointsStateColor } from '@shared/utils/prediction-points.utils';

@Component({
  selector: 'app-match-predictions-modal',
  imports: [TranslatePipe, DecimalPipe, TeamNameComponent],
  templateUrl: './match-predictions-modal.component.html',
  styleUrl: './match-predictions-modal.component.scss'
})
export class MatchPredictionsModalComponent {
  private readonly translations = inject(TranslationService);
  readonly match = input.required<LeaderboardDayMatch>();
  readonly details = input<LeaderboardMatchPredictionsResponse | null>(null);
  readonly loading = input(false);
  readonly skeletonRows = input(7);
  readonly errorMessage = input<string | null>(null);
  readonly closeModal = output<void>();

  protected readonly submittedCount = computed(() => {
    const details = this.details();

    return details ? details.users.filter((user) => user.prediction !== null || user.predictionHidden).length : 0;
  });

  protected readonly userCount = computed(() => this.details()?.users.length ?? 0);
  protected readonly lockedLabel = computed(() => (this.details()?.locked ?? this.match().roundLocked ? this.translations.translate("ui.locked_tips") : this.translations.translate("ui.open_round")));
  protected readonly skeletonItems = computed(() =>
    Array.from({ length: Math.max(Math.min(this.skeletonRows(), 80), 1) }, (_value, index) => index)
  );

  protected close(): void {
    this.closeModal.emit();
  }

  protected pointsColor(user: LeaderboardMatchPredictionUser): string | null {
    return getPredictionPointsStateColor(user.points.state);
  }
}
