import { inject, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { AppStateService } from '@core/state/app-state.service';
import { Competition, CompetitionsResponse, JoinCompetitionResponse, UpdateCompetitionTiebreakerResponse } from '@models/competition.models';
import { LeaderboardService } from '@services/leaderboard.service';
import { MatchesService } from '@services/matches.service';
import { PaymentsService } from '@services/payments.service';
import { AuthApiProvider } from '@services/providers/auth-api.provider';
import { CompetitionsApiProvider } from '@services/providers/competitions-api.provider';

@Injectable({
  providedIn: 'root'
})
export class CompetitionsService {
  private readonly appState = inject(AppStateService);
  private readonly authApi = inject(AuthApiProvider);
  private readonly leaderboardService = inject(LeaderboardService);
  private readonly matchesService = inject(MatchesService);
  private readonly paymentsService = inject(PaymentsService);
  private readonly competitionsApi = inject(CompetitionsApiProvider);
  private readonly competitionsSignal = signal<Competition[]>([]);
  private readonly loadedSignal = signal(false);

  readonly competitions = this.competitionsSignal.asReadonly();
  readonly loaded = this.loadedSignal.asReadonly();

  ensureCompetitions(): Observable<CompetitionsResponse> | null {
    if (this.loadedSignal()) {
      return null;
    }

    return this.refreshCompetitions();
  }

  refreshCompetitions(): Observable<CompetitionsResponse> {
    return this.competitionsApi.getCompetitions().pipe(
      tap(({ competitions }) => {
        this.competitionsSignal.set(competitions);
        this.loadedSignal.set(true);

        const activeCompetition = this.appState.activeCompetition();

        const refreshedActiveCompetition = activeCompetition
          ? competitions.find((competition) => competition.id === activeCompetition.id)
          : null;

        if (activeCompetition && !refreshedActiveCompetition) {
          this.appState.clearActiveCompetition();
        } else if (refreshedActiveCompetition) {
          this.appState.setActiveCompetition(refreshedActiveCompetition);
        }
      })
    );
  }

  refreshAdminCompetitions(): Observable<CompetitionsResponse> {
    return this.competitionsApi.getAdminCompetitions().pipe(
      tap(({ competitions }) => {
        this.competitionsSignal.set(competitions);
        this.loadedSignal.set(true);

        const activeCompetition = this.appState.activeCompetition();

        const refreshedActiveCompetition = activeCompetition
          ? competitions.find((competition) => competition.id === activeCompetition.id)
          : null;

        if (activeCompetition && !refreshedActiveCompetition) {
          this.appState.clearActiveCompetition();
        } else if (refreshedActiveCompetition) {
          this.appState.setActiveCompetition(refreshedActiveCompetition);
        }
      })
    );
  }

  enterCompetition(competition: Competition): void {
    this.appState.setActiveCompetition(competition);
    this.matchesService.clearCompetitionData();
    this.leaderboardService.clearCompetitionData();
    this.paymentsService.clearPaymentInfo();
    this.authApi.getCurrentUser().subscribe((user) => {
      this.appState.updateCurrentUser(user);
    });
  }

  exitCompetition(): void {
    this.appState.clearActiveCompetition();
    this.matchesService.clearCompetitionData();
    this.leaderboardService.clearCompetitionData();
    this.paymentsService.clearPaymentInfo();
  }

  clearCompetitions(): void {
    this.competitionsSignal.set([]);
    this.loadedSignal.set(false);
    this.exitCompetition();
  }

  updateTiebreaker(tiebreakerName: string): Observable<UpdateCompetitionTiebreakerResponse> {
    return this.competitionsApi.updateTiebreaker({ tiebreakerName }).pipe(
      tap(({ competition }) => {
        this.competitionsSignal.update((competitions) =>
          competitions.map((currentCompetition) =>
            currentCompetition.id === competition.id ? competition : currentCompetition
          )
        );
        this.appState.setActiveCompetition(competition);
        this.leaderboardService.clearCompetitionData();
      })
    );
  }

  joinCompetition(competition: Competition, passcode: string): Observable<JoinCompetitionResponse> {
    return this.competitionsApi.joinCompetition(competition.id, { passcode }).pipe(
      tap(({ competition: joinedCompetition }) => {
        this.competitionsSignal.update((competitions) =>
          competitions.map((currentCompetition) =>
            currentCompetition.id === joinedCompetition.id ? joinedCompetition : currentCompetition
          )
        );
        this.enterCompetition(joinedCompetition);
      })
    );
  }
}
