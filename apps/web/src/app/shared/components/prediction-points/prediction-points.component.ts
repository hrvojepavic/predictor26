import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { DecimalPipe } from '@angular/common';
import { inject, Component, computed, input } from '@angular/core';

import { MatchPrediction, MatchScore } from '@models/match.models';
import { formatFixedNumber } from '@shared/utils/number-format.utils';
import { calculatePredictionPoints, getPredictionPointsStateColor } from '@shared/utils/prediction-points.utils';

@Component({
  selector: 'app-prediction-points',
  imports: [TranslatePipe, DecimalPipe],
  templateUrl: './prediction-points.component.html',
  styleUrl: './prediction-points.component.scss'
})
export class PredictionPointsComponent {
  private readonly translations = inject(TranslationService);
  readonly prediction = input.required<MatchPrediction>();
  readonly finalScore = input<MatchScore | null>(null);
  readonly isPostponed = input(false);

  protected readonly points = computed(() => calculatePredictionPoints(this.prediction(), this.finalScore(), this.isPostponed()));
  protected readonly color = computed(() => getPredictionPointsStateColor(this.points().state));
  protected readonly title = computed(() => {
    const points = this.points();

    if (points.state === 'void') {
      return this.translations.translate("ui.postponed_match_prediction_is_void");
    }

    return this.translations.translate('ui.correct_outcome_p0_correct_score_p1_p2', { p0: formatFixedNumber(points.outcomePoints), p1: formatFixedNumber(points.exactScorePoints), p2: formatFixedNumber(points.available ?? 0) });
  });
}
