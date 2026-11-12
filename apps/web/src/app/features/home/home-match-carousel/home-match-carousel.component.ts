import { TranslationService } from '@services/translation.service';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Component, computed, inject, signal } from '@angular/core';

import {
  LeaderboardDayMatch,
  LeaderboardMatchDay,
  LeaderboardMatchPredictionsResponse,
  LeaderboardMatchStatus
} from '@models/leaderboard.models';
import { AppStateService } from '@core/state/app-state.service';
import { LeaderboardService } from '@services/leaderboard.service';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { TeamNameComponent } from '@shared/components/team-name/team-name.component';
import { OddsFormatPipe } from '@shared/pipes/odds-format.pipe';
import { MatchPredictionsModalComponent } from './match-predictions-modal.component';

interface MatchDayView extends LeaderboardMatchDay {
  readonly label: string;
}

interface MatchCardView extends LeaderboardDayMatch {
  readonly statusLabel: string;
  readonly winningOutcome: '1' | 'X' | '2' | null;
  readonly canOpenDetails: boolean;
}

@Component({
  selector: 'app-home-match-carousel',
  imports: [TranslatePipe, LocalizedDatePipe, MatchPredictionsModalComponent, ModalShellComponent, OddsFormatPipe, TeamNameComponent],
  templateUrl: './home-match-carousel.component.html',
  styleUrl: './home-match-carousel.component.scss'
})
export class HomeMatchCarouselComponent {
  private readonly translations = inject(TranslationService);
  private readonly appState = inject(AppStateService);
  private readonly leaderboardService = inject(LeaderboardService);
  private readonly minimumModalSkeletonMs = 500;

  protected readonly isLoggedIn = this.appState.isLoggedIn;
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly selectedDayIndex = signal(0);
  protected readonly openingMatchId = signal<number | null>(null);
  protected readonly selectedMatch = signal<LeaderboardDayMatch | null>(null);
  protected readonly selectedMatchDetails = signal<LeaderboardMatchPredictionsResponse | null>(null);
  protected readonly selectedMatchError = signal<string | null>(null);
  protected readonly modalSkeletonVisible = signal(false);
  protected readonly fallbackDayLabel = computed(() => getDayLabel(getLocalDateKey(new Date()), this.translations.language()));
  protected readonly skeletonUserCount = computed(() => this.selectedMatchDetails()?.users.length ?? this.leaderboardService.leaderboard()?.totalUsers ?? 7);
  protected readonly days = computed<MatchDayView[]>(() =>
    (this.leaderboardService.matchDays() ?? []).map((day) => ({
      ...day,
      label: getDayLabel(day.date, this.translations.language())
    }))
  );
  protected readonly selectedDay = computed(() => this.days()[this.selectedDayIndex()] ?? null);
  protected readonly selectedDayLabel = computed(() => this.selectedDay()?.label ?? this.fallbackDayLabel());
  protected readonly selectedMatches = computed<MatchCardView[]>(() =>
    (this.selectedDay()?.matches ?? [])
      .map((match) => ({
        ...match,
        statusLabel: getStatusLabel(match.status, this.translations),
        winningOutcome: match.finalScore ? getScoreOutcome(match.finalScore.home, match.finalScore.away) : null,
        canOpenDetails: this.isLoggedIn() && match.roundLocked && !match.isPostponed
      }))
      .sort(sortLiveMatchesFirst)
  );
  protected readonly canGoPrevious = computed(() => this.selectedDayIndex() > 0);
  protected readonly canGoNext = computed(() => this.selectedDayIndex() < this.days().length - 1);

  constructor() {
    this.loadDays();
  }

  protected previousDay(): void {
    if (this.canGoPrevious()) {
      this.selectedDayIndex.update((index) => index - 1);
    }
  }

  protected nextDay(): void {
    if (this.canGoNext()) {
      this.selectedDayIndex.update((index) => index + 1);
    }
  }

  protected openMatch(match: LeaderboardDayMatch): void {
    if (!this.isLoggedIn() || !match.roundLocked || match.isPostponed || this.openingMatchId()) {
      return;
    }

    this.openingMatchId.set(match.matchId);
    this.selectedMatch.set(match);
    this.selectedMatchDetails.set(null);
    this.selectedMatchError.set(null);
    this.modalSkeletonVisible.set(true);
    this.errorMessage.set(null);
    const openedAt = Date.now();

    this.leaderboardService.ensureMatchPredictions(match.matchId).subscribe({
      next: (details) => {
        this.finishModalLoad(openedAt, match.matchId, () => {
          this.selectedMatchDetails.set(details);
        });
      },
      error: () => {
        this.finishModalLoad(openedAt, match.matchId, () => {
          this.selectedMatchError.set(this.translations.translate("ui.match_tips_could_not_be_loaded"));
        });
      }
    });
  }

  protected closeMatch(): void {
    this.selectedMatch.set(null);
    this.selectedMatchDetails.set(null);
    this.selectedMatchError.set(null);
    this.modalSkeletonVisible.set(false);
    this.openingMatchId.set(null);
  }

  private loadDays(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    const request = this.leaderboardService.ensureMatchDays();

    if (!request) {
      this.selectToday();
      this.loading.set(false);
      return;
    }

    request.subscribe({
      next: () => {
        this.selectToday();
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.match_schedule_could_not_be_loaded"));
        this.loading.set(false);
      }
    });
  }

  private selectToday(): void {
    const days = this.days();
    const today = getLocalDateKey(new Date());
    const todayIndex = days.findIndex((day) => day.date === today);
    const nextIndex = days.findIndex((day) => day.matches.some((match) => Date.parse(match.kickoffAt) >= Date.now()));
    const selectedIndex = todayIndex >= 0 ? todayIndex : Math.max(nextIndex, 0);

    this.selectedDayIndex.set(selectedIndex);
  }

  private finishModalLoad(openedAt: number, matchId: number, update: () => void): void {
    const remainingDelay = Math.max(this.minimumModalSkeletonMs - (Date.now() - openedAt), 0);

    setTimeout(() => {
      if (this.selectedMatch()?.matchId !== matchId) {
        return;
      }

      update();
      this.modalSkeletonVisible.set(false);
      this.openingMatchId.set(null);
    }, remainingDelay);
  }
}

function getDayLabel(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(`${date}T12:00:00`));
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getStatusLabel(status: LeaderboardMatchStatus, translations: TranslationService): string {
  const labels: Record<LeaderboardMatchStatus, string> = {
    postponed: translations.translate("ui.postponed"),
    finished: translations.translate("ui.finished"),
    live: translations.translate("ui.live"),
    coming_up: translations.translate("ui.coming_up"),
    undecided: translations.translate("ui.undecided")
  };

  return labels[status];
}

function getScoreOutcome(homeScore: number, awayScore: number): '1' | 'X' | '2' {
  if (homeScore > awayScore) {
    return '1';
  }

  if (homeScore < awayScore) {
    return '2';
  }

  return 'X';
}

function sortLiveMatchesFirst(firstMatch: MatchCardView, secondMatch: MatchCardView): number {
  if (firstMatch.status === 'live' && secondMatch.status !== 'live') {
    return -1;
  }

  if (firstMatch.status !== 'live' && secondMatch.status === 'live') {
    return 1;
  }

  const kickoffComparison = Date.parse(firstMatch.kickoffAt) - Date.parse(secondMatch.kickoffAt);

  if (kickoffComparison !== 0) {
    return kickoffComparison;
  }

  return firstMatch.matchNumber - secondMatch.matchNumber;
}
