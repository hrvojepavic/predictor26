import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

import { LeaderboardRoundDetails, LeaderboardRoundMatch, LeaderboardUser } from '@models/leaderboard.models';
import { TeamNameComponent } from '@shared/components/team-name/team-name.component';
import { getPredictionPointsStateColor } from '@shared/utils/prediction-points.utils';

@Component({
  selector: 'app-leaderboard-round-modal',
  imports: [TranslatePipe, DecimalPipe, TeamNameComponent],
  templateUrl: './leaderboard-round-modal.component.html',
  styleUrl: './leaderboard-round-modal.component.scss'
})
export class LeaderboardRoundModalComponent {
  readonly user = input.required<LeaderboardUser>();
  readonly round = input.required<LeaderboardRoundDetails>();

  readonly closeModal = output<void>();
  protected readonly totalPoints = computed(() => {
    const matches = this.round().matches;

    return {
      earned: sumKnownPoints(matches.map((match) => match.points.earned)),
      available: sumKnownPoints(matches.map((match) => match.points.available))
    };
  });

  protected close(): void {
    this.closeModal.emit();
  }

  protected pointsColor(match: LeaderboardRoundMatch): string | null {
    return getPredictionPointsStateColor(match.points.state);
  }
}

function sumKnownPoints(points: Array<number | null>): number | null {
  if (points.length === 0 || points.some((point) => point === null)) {
    return null;
  }

  const knownPoints = points as number[];

  return Math.round((knownPoints.reduce((total, point) => total + point, 0) + Number.EPSILON) * 100) / 100;
}
