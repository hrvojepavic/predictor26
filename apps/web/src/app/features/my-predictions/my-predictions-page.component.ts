import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { MatchWithPrediction } from '@models/match.models';
import { MatchesService } from '@services/matches.service';
import { MatchSortMode, MatchSortPreferenceService } from '@core/state/match-sort-preference.service';
import { MatchSortMenuComponent } from '@shared/components/match-sort-menu/match-sort-menu.component';
import { PredictionPointsComponent } from '@shared/components/prediction-points/prediction-points.component';
import { TeamNameComponent } from '@shared/components/team-name/team-name.component';
import { OddsFormatPipe } from '@shared/pipes/odds-format.pipe';
import { sortMatchesByKickoff } from '@shared/utils/match-sorting.utils';
import { calculatePredictionPoints, getPredictionPointsStateColor } from '@shared/utils/prediction-points.utils';

interface TipGroup {
  readonly label: string;
  readonly sections: TipSection[];
}

interface TipSection {
  readonly label: string;
  readonly matches: MatchWithPrediction[];
}

@Component({
  selector: 'app-my-predictions-page',
  imports: [DatePipe, MatchSortMenuComponent, OddsFormatPipe, PredictionPointsComponent, RouterLink, TeamNameComponent],
  templateUrl: './my-predictions-page.component.html',
  styleUrl: './my-predictions-page.component.scss'
})
export class MyPredictionsPageComponent {
  private readonly matchesService = inject(MatchesService);
  private readonly route = inject(ActivatedRoute);
  private readonly routeCompetitionSlug = toSignal(this.route.paramMap.pipe(map((params) => params.get('slug'))), {
    initialValue: this.route.snapshot.paramMap.get('slug')
  });
  private readonly sortPreference = inject(MatchSortPreferenceService);

  protected readonly postPredictionsRouterLink = computed(() => {
    const slug = this.routeCompetitionSlug();

    return slug ? ['/competition', slug, 'predictions'] : ['/'];
  });
  protected readonly matches = this.matchesService.matches;
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly predictedMatches = this.matchesService.predictedMatches;
  protected readonly groupedPredictedMatches = computed(() =>
    groupTips(this.predictedMatches(), this.sortPreference.sortMode())
  );

  constructor() {
    this.loadMatches();
  }

  protected matchStatus(match: MatchWithPrediction): string {
    if (match.finalScore) {
      return 'Finished';
    }

    if (Date.parse(match.kickoffAt) <= Date.now()) {
      return 'Ongoing';
    }

    return 'Upcoming';
  }

  protected predictionStateColor(match: MatchWithPrediction): string | null {
    if (!match.prediction) {
      return '#111827';
    }

    return getPredictionPointsStateColor(calculatePredictionPoints(match.prediction, match.finalScore, match.isPostponed).state) ?? '#111827';
  }

  private loadMatches(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    const request = this.matchesService.ensurePredictedMatches();

    if (!request) {
      this.loading.set(false);
      return;
    }

    request.subscribe({
      next: () => {
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Your tips could not be loaded.');
        this.loading.set(false);
      }
    });
  }
}

function groupTips(matches: readonly MatchWithPrediction[], sortMode: MatchSortMode): TipGroup[] {
  return sortMode === 'groups' ? groupTipsByGroups(matches) : groupTipsByRounds(matches);
}

function groupTipsByRounds(matches: readonly MatchWithPrediction[]): TipGroup[] {
  const groups = new Map<string, MatchWithPrediction[]>();

  for (const match of matches) {
    groups.set(match.predictionRound, [...(groups.get(match.predictionRound) ?? []), match]);
  }

  return Array.from(groups, ([label, groupedMatches]) => ({
    label,
    sections: groupByGroupName(groupedMatches)
  }));
}

function groupTipsByGroups(matches: readonly MatchWithPrediction[]): TipGroup[] {
  const groups = new Map<string, MatchWithPrediction[]>();

  for (const match of matches) {
    const label = match.groupName ? `Group ${match.groupName}` : match.roundLabel;
    groups.set(label, [...(groups.get(label) ?? []), match]);
  }

  return Array.from(groups, ([label, groupedMatches]) => ({
    label,
    sections: groupByPredictionRound(groupedMatches)
  }));
}

function groupByGroupName(matches: readonly MatchWithPrediction[]): TipSection[] {
  const sections = new Map<string, MatchWithPrediction[]>();

  for (const match of matches) {
    const label = match.groupName ? `Group ${match.groupName}` : match.roundLabel;
    sections.set(label, [...(sections.get(label) ?? []), match]);
  }

  return Array.from(sections, ([label, sectionMatches]) => ({
    label,
    matches: sortMatchesByKickoff(sectionMatches)
  }));
}

function groupByPredictionRound(matches: readonly MatchWithPrediction[]): TipSection[] {
  const sections = new Map<string, MatchWithPrediction[]>();

  for (const match of matches) {
    sections.set(match.predictionRound, [...(sections.get(match.predictionRound) ?? []), match]);
  }

  return Array.from(sections, ([label, sectionMatches]) => ({
    label,
    matches: sortMatchesByKickoff(sectionMatches)
  }));
}
