import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import { AppStateService } from '@core/state/app-state.service';
import { LeaderboardService } from '@services/leaderboard.service';
import { OddsFormatPipe } from '@shared/pipes/odds-format.pipe';

@Component({
  selector: 'app-stats-page',
  imports: [TranslatePipe, DecimalPipe, OddsFormatPipe],
  templateUrl: './stats-page.component.html',
  styleUrl: './stats-page.component.scss'
})
export class StatsPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly appState = inject(AppStateService);
  private readonly leaderboardService = inject(LeaderboardService);

  protected readonly stats = this.leaderboardService.stats;
  protected readonly currentUserId = computed(() => this.appState.currentUser()?.id ?? null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly expandedExactScoreUserId = signal<number | null>(null);
  protected readonly expandedOutcomeUserId = signal<number | null>(null);
  protected readonly hasStats = computed(() => {
    const stats = this.stats();

    return Boolean(
      stats &&
        (stats.groupLeaders.some((group) => group.leaders.length > 0) ||
          stats.exactScoreLeaders.length > 0 ||
          stats.outcomeLeaders.length > 0 ||
          stats.biggestOddsWin)
    );
  });

  constructor() {
    this.loadStats();
  }

  protected toggleExactScoreLeader(userId: number): void {
    this.expandedExactScoreUserId.update((expandedUserId) => (expandedUserId === userId ? null : userId));
  }

  protected toggleOutcomeLeader(userId: number): void {
    this.expandedOutcomeUserId.update((expandedUserId) => (expandedUserId === userId ? null : userId));
  }

  protected teamLabel(team: { readonly name: string; readonly flag: string | null }): string {
    const flag = team.flag && !/^(?:https:\/\/|\/)/i.test(team.flag) ? `${team.flag} ` : '';

    return `${flag}${team.name}`;
  }

  private loadStats(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    const request = this.leaderboardService.ensureStats();

    if (!request) {
      this.loading.set(false);
      return;
    }

    request.subscribe({
      next: () => {
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.stats_could_not_be_loaded"));
        this.loading.set(false);
      }
    });
  }
}
