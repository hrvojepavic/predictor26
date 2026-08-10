import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';

import { AppStateService } from '@core/state/app-state.service';
import { MatchWithPrediction } from '@models/match.models';
import { CompetitionsService } from '@services/competitions.service';
import { MatchesService } from '@services/matches.service';
import { CompetitionsApiProvider } from '@services/providers/competitions-api.provider';
import { MatchSortMode, MatchSortPreferenceService } from '@core/state/match-sort-preference.service';
import { MatchSortMenuComponent } from '@shared/components/match-sort-menu/match-sort-menu.component';
import { PredictionPointsComponent } from '@shared/components/prediction-points/prediction-points.component';
import { TeamNameComponent } from '@shared/components/team-name/team-name.component';
import { OddsFormatPipe } from '@shared/pipes/odds-format.pipe';
import {
  calculatePredictionPoints,
  getPredictionPointsStateColor,
  PredictionPointsState
} from '@shared/utils/prediction-points.utils';
import { isValidScore, ScoreDraft, updateScoreDraft } from '@shared/utils/score-draft.utils';
import { sortMatchesByKickoff } from '@shared/utils/match-sorting.utils';

interface MatchGroup {
  readonly label: string;
  readonly savedCount: number;
  readonly totalCount: number;
  readonly deadlineAt: string | null;
  readonly locked: boolean | null;
  readonly sections: MatchSection[];
}

interface MatchSection {
  readonly label: string;
  readonly matches: MatchWithPrediction[];
}

@Component({
  selector: 'app-predictions-page',
  imports: [DatePipe, MatchSortMenuComponent, OddsFormatPipe, PredictionPointsComponent, TeamNameComponent],
  templateUrl: './predictions-page.component.html',
  styleUrl: './predictions-page.component.scss'
})
export class PredictionsPageComponent {
  private readonly appState = inject(AppStateService);
  private readonly competitionsService = inject(CompetitionsService);
  private readonly matchesService = inject(MatchesService);
  private readonly sortPreference = inject(MatchSortPreferenceService);
  private readonly competitionsApi = inject(CompetitionsApiProvider);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly activeCompetition = this.appState.activeCompetition;
  protected readonly canPostPredictions = computed(() => this.appState.currentUser()?.role !== 'super_admin');
  protected readonly matches = this.matchesService.matches;
  protected readonly drafts = signal<Record<number, ScoreDraft>>({});
  protected readonly tiebreakerOptions = signal<string[]>([]);
  protected readonly selectedTiebreakerName = signal('');
  protected readonly savingTiebreaker = signal(false);
  protected readonly loading = signal(true);
  protected readonly savingIds = signal<ReadonlySet<number>>(new Set<number>());
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly lastSavedMessage = signal<string | null>(null);
  protected readonly postponedNoticeMatchId = signal<number | null>(null);
  protected readonly activeProgressLabel = signal<string | null>(null);
  protected readonly now = signal(Date.now());
  protected readonly openMatches = computed(() => getOpenMatches(this.matches(), this.now()));
  protected readonly groupedMatches = computed(() => groupMatches(this.openMatches(), this.sortPreference.sortMode()));
  protected readonly closedRoundSummaries = computed(() =>
    groupMatchesByRounds(this.matches()).filter((group) => isPredictionGroupClosed(group, this.now()))
  );
  protected readonly progressGroups = computed(() => groupMatches(this.openMatches(), 'rounds'));
  protected readonly activeProgress = computed(() => {
    const groups = this.progressGroups();
    const activeLabel = this.activeProgressLabel();
    const group =
      groups.find((currentGroup) => currentGroup.label === activeLabel) ??
      groups.find((currentGroup) => !currentGroup.locked);

    if (!group) {
      return null;
    }

    return {
      ...group,
      complete: group.savedCount === group.totalCount && group.totalCount > 0
    };
  });
  private readonly saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private postponedNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      this.selectedTiebreakerName.set(this.activeCompetition()?.tiebreakerName ?? '');
    });

    interval(60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.now.set(Date.now());
      });

    this.loadMatches();
    this.loadTiebreakerOptions();
  }

  protected isFirstPredictionRound(group: MatchGroup): boolean {
    return group.sections.some((section) => section.matches.some((match) => isFirstPredictionRoundLabel(match.predictionRound)));
  }

  protected updateTiebreaker(value: string): void {
    if (!this.canPostPredictions()) {
      return;
    }

    const tiebreakerName = value.trim();

    if (!tiebreakerName || tiebreakerName === this.activeCompetition()?.tiebreakerName || this.savingTiebreaker()) {
      return;
    }

    this.savingTiebreaker.set(true);
    this.errorMessage.set(null);

    this.competitionsService.updateTiebreaker(tiebreakerName).subscribe({
      next: () => {
        this.selectedTiebreakerName.set(tiebreakerName);
        this.lastSavedMessage.set(`Saved winner pick: ${tiebreakerName}.`);
        this.savingTiebreaker.set(false);
      },
      error: () => {
        this.errorMessage.set('Winner pick could not be saved.');
        this.savingTiebreaker.set(false);
      }
    });
  }

  protected updateDraft(matchId: number, side: keyof ScoreDraft, value: string): void {
    if (!this.canPostPredictions()) {
      return;
    }

    const match = this.matches().find((currentMatch) => currentMatch.id === matchId);

    if (match) {
      this.activeProgressLabel.set(match.predictionRound);
    }

    this.drafts.update((drafts) => updateScoreDraft(drafts, matchId, side, value));
    this.queueSave(matchId);
  }

  protected showPostponedNotice(match: MatchWithPrediction): void {
    if (!match.isPostponed) {
      return;
    }

    this.postponedNoticeMatchId.set(match.id);

    if (this.postponedNoticeTimer) {
      clearTimeout(this.postponedNoticeTimer);
    }

    this.postponedNoticeTimer = setTimeout(() => {
      if (this.postponedNoticeMatchId() === match.id) {
        this.postponedNoticeMatchId.set(null);
      }
    }, 3500);
  }

  protected timeRemaining(deadlineAt: string): string {
    const remainingMs = Date.parse(deadlineAt) - this.now();

    if (remainingMs <= 0) {
      return 'closed';
    }

    const totalMinutes = Math.floor(remainingMs / 60_000);
    const days = Math.floor(totalMinutes / 1_440);
    const hours = Math.floor((totalMinutes % 1_440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    }

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
  }

  protected hasTimeRemaining(deadlineAt: string): boolean {
    return Date.parse(deadlineAt) > this.now();
  }

  protected predictionState(match: MatchWithPrediction): PredictionPointsState | null {
    if (!match.prediction) {
      return null;
    }

    return calculatePredictionPoints(match.prediction, match.finalScore, match.isPostponed).state;
  }

  protected predictionStateColor(match: MatchWithPrediction): string | null {
    return getPredictionPointsStateColor(this.predictionState(match));
  }

  protected selectedPredictionStateColor(match: MatchWithPrediction, outcome: '1' | 'X' | '2'): string | null {
    if (match.prediction?.odds?.outcome !== outcome) {
      return null;
    }

    return this.predictionStateColor(match);
  }

  private loadMatches(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    const request = this.matchesService.ensureMatches();

    if (!request) {
      this.setDraftsFromMatches();
      this.loading.set(false);
      return;
    }

    request.subscribe({
      next: ({ matches }) => {
        this.setDraftsFromMatches(matches);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Matches could not be loaded.');
        this.loading.set(false);
      }
    });
  }

  private loadTiebreakerOptions(): void {
    this.competitionsApi.getCompetitionTeams().subscribe({
      next: ({ teams }) => {
        this.tiebreakerOptions.set(teams);
      },
      error: () => {
        this.errorMessage.set('Winner options could not be loaded.');
      }
    });
  }

  private setDraftsFromMatches(matches = this.matches()): void {
    this.drafts.set(
      Object.fromEntries(
        matches.map((match) => [
          match.id,
          {
            home: match.prediction?.home ?? null,
            away: match.prediction?.away ?? null
          }
        ])
      )
    );
  }

  private setSaving(matchId: number, saving: boolean): void {
    this.savingIds.update((savingIds) => {
      const nextSavingIds = new Set(savingIds);

      if (saving) {
        nextSavingIds.add(matchId);
      } else {
        nextSavingIds.delete(matchId);
      }

      return nextSavingIds;
    });
  }

  private queueSave(matchId: number): void {
    const match = this.matches().find((currentMatch) => currentMatch.id === matchId);
    const draft = this.drafts()[matchId];

    if (!match || match.isPostponed || match.predictionLocked || !isValidScore(draft?.home) || !isValidScore(draft?.away)) {
      return;
    }

    if (match.prediction?.home === draft.home && match.prediction.away === draft.away) {
      return;
    }

    const homeScore = draft.home;
    const awayScore = draft.away;
    const existingTimer = this.saveTimers.get(matchId);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.saveTimers.set(
      matchId,
      setTimeout(() => {
        this.saveTimers.delete(matchId);
        this.savePrediction(match, homeScore, awayScore);
      }, 500)
    );
  }

  private savePrediction(match: MatchWithPrediction, homeScore: number, awayScore: number): void {
    this.setSaving(match.id, true);
    this.errorMessage.set(null);

    this.matchesService.savePrediction(match.id, { homeScore, awayScore }).subscribe({
      next: ({ prediction }) => {
        this.lastSavedMessage.set(
          `Saved ${match.homeTeam.name} ${homeScore}:${awayScore} ${match.awayTeam.name}.`
        );
        this.setSaving(match.id, false);
      },
      error: () => {
        this.errorMessage.set('Prediction could not be saved.');
        this.setSaving(match.id, false);
      }
    });
  }
}

function isFirstPredictionRoundLabel(label: string): boolean {
  return label === 'Group stage - Round 1' || label === 'Week 1';
}

function groupMatches(matches: readonly MatchWithPrediction[], sortMode: MatchSortMode): MatchGroup[] {
  return sortMode === 'groups' ? groupMatchesByGroups(matches) : groupMatchesByRounds(matches);
}

function isPredictionOpen(match: MatchWithPrediction, now: number): boolean {
  return !match.isPostponed && !match.predictionLocked && Date.parse(match.predictionDeadlineAt) > now;
}

function getOpenMatches(matches: readonly MatchWithPrediction[], now: number): MatchWithPrediction[] {
  const openPredictionRounds = new Set(
    matches.filter((match) => isPredictionOpen(match, now)).map((match) => match.predictionRound)
  );

  return matches.filter((match) => isPredictionOpen(match, now) || (match.isPostponed && openPredictionRounds.has(match.predictionRound)));
}

function isPredictionGroupClosed(group: MatchGroup, now: number): boolean {
  return group.locked === true || (group.deadlineAt !== null && Date.parse(group.deadlineAt) <= now);
}

function groupMatchesByRounds(matches: readonly MatchWithPrediction[]): MatchGroup[] {
  const groups = new Map<string, MatchWithPrediction[]>();

  for (const match of matches) {
    const label = match.predictionRound;
    groups.set(label, [...(groups.get(label) ?? []), match]);
  }

  return Array.from(groups, ([label, groupedMatches]) => {
    const activeMatches = groupedMatches.filter((match) => !match.isPostponed);
    const deadlineMatch = activeMatches[0] ?? groupedMatches[0];

    return {
      label,
      deadlineAt: deadlineMatch.predictionDeadlineAt,
      locked: activeMatches.length > 0 ? deadlineMatch.predictionLocked : false,
      savedCount: activeMatches.filter((match) => match.prediction !== null).length,
      totalCount: activeMatches.length,
      sections: groupRoundSections(groupedMatches)
    };
  });
}

function groupRoundSections(matches: readonly MatchWithPrediction[]): MatchSection[] {
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

function groupMatchesByGroups(matches: readonly MatchWithPrediction[]): MatchGroup[] {
  const groups = new Map<string, MatchWithPrediction[]>();

  for (const match of matches) {
    const label = match.groupName ? `Group ${match.groupName}` : match.roundLabel;
    groups.set(label, [...(groups.get(label) ?? []), match]);
  }

  return Array.from(groups, ([label, groupedMatches]) => {
    const activeMatches = groupedMatches.filter((match) => !match.isPostponed);

    return {
      label,
      deadlineAt: null,
      locked: null,
      savedCount: activeMatches.filter((match) => match.prediction !== null).length,
      totalCount: activeMatches.length,
      sections: groupPredictionRoundSections(groupedMatches)
    };
  });
}

function groupPredictionRoundSections(matches: readonly MatchWithPrediction[]): MatchSection[] {
  const sections = new Map<string, MatchWithPrediction[]>();

  for (const match of matches) {
    sections.set(match.predictionRound, [...(sections.get(match.predictionRound) ?? []), match]);
  }

  return Array.from(sections, ([label, sectionMatches]) => ({
    label,
    matches: sortMatchesByKickoff(sectionMatches)
  }));
}
