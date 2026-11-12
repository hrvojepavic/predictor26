import { TranslationService } from '@services/translation.service';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Match, MatchImportValidation } from '@models/match.models';
import { AdminMatchesApiProvider } from '@services/providers/admin-matches-api.provider';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { SecretCodeModalComponent } from '@shared/components/secret-code-modal/secret-code-modal.component';
import { TeamNameComponent } from '@shared/components/team-name/team-name.component';
import { OddsFormatPipe } from '@shared/pipes/odds-format.pipe';
import { isValidScore, ScoreDraft, updateScoreDraft } from '@shared/utils/score-draft.utils';
import { AdminMatchKickoffModalComponent, KickoffChangeConfirmation } from './admin-match-kickoff-modal.component';
import { AdminManualMatchModalComponent, ManualMatchConfirmation } from './admin-manual-match-modal.component';

interface MatchGroup {
  readonly label: string;
  readonly releasedForPredictions: boolean;
  readonly matches: Match[];
}

type MatchFilter = 'active' | 'required' | 'inactive';
type PendingSecretAction = 'schedule' | 'odds' | 'schedule-with-odds' | 'release-round' | 'postponed';

@Component({
  selector: 'app-admin-matches-page',
  imports: [TranslatePipe,
    AdminManualMatchModalComponent,
    AdminMatchKickoffModalComponent,
    LocalizedDatePipe,
    ModalShellComponent,
    OddsFormatPipe,
    RouterLink,
    SecretCodeModalComponent,
    TeamNameComponent
  ],
  templateUrl: './admin-matches-page.component.html',
  styleUrl: './admin-matches-page.component.scss'
})
export class AdminMatchesPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly adminMatchesApi = inject(AdminMatchesApiProvider);

  protected readonly matches = signal<Match[]>([]);
  protected readonly drafts = signal<Record<number, ScoreDraft>>({});
  protected readonly loading = signal(true);
  protected readonly importing = signal(false);
  protected readonly syncingOdds = signal(false);
  protected readonly importingWithOdds = signal(false);
  protected readonly releasingRound = signal(false);
  protected readonly importMatchesWithOddsEnabled = signal(false);
  protected readonly addingMatch = signal(false);
  protected readonly addMatchModalOpen = signal(false);
  protected readonly addMatchErrorMessage = signal<string | null>(null);
  protected readonly kickoffErrorMessage = signal<string | null>(null);
  protected readonly editingKickoffMatch = signal<Match | null>(null);
  protected readonly savingIds = signal<ReadonlySet<number>>(new Set<number>());
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly importMessage = signal<string | null>(null);
  protected readonly secretCodeErrorMessage = signal<string | null>(null);
  protected readonly pendingSecretAction = signal<PendingSecretAction | null>(null);
  protected readonly pendingReleaseRoundLabel = signal<string | null>(null);
  protected readonly pendingPostponedMatch = signal<Match | null>(null);
  protected readonly selectedFilter = signal<MatchFilter>('active');
  protected readonly requiredActionCount = computed(() => this.matches().filter((match) => isRequiredAction(match)).length);
  protected readonly filteredMatches = computed(() => filterMatches(this.matches(), this.selectedFilter()));
  protected readonly groupedMatches = computed(() => groupMatches(this.filteredMatches()));
  protected readonly existingTeamNames = computed(() => getExistingTeamNames(this.matches()));
  protected readonly scheduleActionLabel = computed(() =>
    this.importing()
      ? this.matches().length > 0
        ? 'Syncing...'
        : 'Importing...'
      : this.matches().length > 0
        ? this.translations.translate("ui.sync_fixtures")
        : this.translations.translate("ui.import_fixtures")
  );
  protected readonly oddsActionLabel = computed(() => (this.syncingOdds() ? this.translations.translate("ui.syncing_odds") : this.translations.translate("ui.sync_odds")));
  protected readonly combinedImportActionLabel = computed(() =>
    this.importingWithOdds()
      ? this.matches().length > 0
        ? 'Syncing...'
        : 'Importing...'
      : this.matches().length > 0
        ? this.translations.translate("ui.sync_fixtures_and_odds")
        : this.translations.translate("ui.import_fixtures_and_odds")
  );
  private readonly saveTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor() {
    this.loadMatches();
  }

  protected requestImportMatches(): void {
    if (this.importing()) {
      return;
    }

    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);
    this.pendingSecretAction.set('schedule');
  }

  protected requestSyncOdds(): void {
    if (this.syncingOdds() || this.matches().length === 0) {
      return;
    }

    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);
    this.pendingSecretAction.set('odds');
  }

  protected requestImportMatchesWithOdds(): void {
    if (this.importingWithOdds()) {
      return;
    }

    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);
    this.pendingSecretAction.set('schedule-with-odds');
  }

  protected requestReleaseRound(roundLabel: string): void {
    if (this.isPendingSecretActionSubmitting()) {
      return;
    }

    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);
    this.pendingReleaseRoundLabel.set(roundLabel);
    this.pendingSecretAction.set('release-round');
  }

  protected requestPostponedToggle(match: Match): void {
    if (this.isPendingSecretActionSubmitting() || this.savingIds().has(match.id)) {
      return;
    }

    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);
    this.pendingPostponedMatch.set(match);
    this.pendingSecretAction.set('postponed');
  }

  protected openAddMatchModal(): void {
    if (this.addingMatch()) {
      return;
    }

    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.addMatchErrorMessage.set(null);
    this.addMatchModalOpen.set(true);
  }

  protected cancelAddMatch(): void {
    if (!this.addingMatch()) {
      this.addMatchModalOpen.set(false);
      this.addMatchErrorMessage.set(null);
    }
  }

  protected confirmAddMatch(match: ManualMatchConfirmation): void {
    if (this.addingMatch()) {
      return;
    }

    this.addingMatch.set(true);
    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.addMatchErrorMessage.set(null);

    this.adminMatchesApi.createMatch(match).subscribe({
      next: ({ match: createdMatch, matches }) => {
        this.setMatches(matches);
        this.importMessage.set(this.translations.translate('ui.match_p0_added', { p0: createdMatch.matchNumber }));
        this.addMatchModalOpen.set(false);
        this.addingMatch.set(false);
        this.ensureSelectedFilterHasResults();
      },
      error: (error: unknown) => {
        const message =
          error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
            ? error.error.message
            : this.translations.translate("ui.match_could_not_be_added");

        if (error instanceof HttpErrorResponse && [400, 403].includes(error.status)) {
          this.addMatchErrorMessage.set(message);
        } else {
          this.errorMessage.set(message);
          this.addMatchModalOpen.set(false);
        }

        this.addingMatch.set(false);
      }
    });
  }

  protected editKickoff(match: Match): void {
    if (this.savingIds().has(match.id)) {
      return;
    }

    this.errorMessage.set(null);
    this.kickoffErrorMessage.set(null);
    this.editingKickoffMatch.set(match);
  }

  protected cancelKickoffChange(): void {
    const match = this.editingKickoffMatch();

    if (match && !this.savingIds().has(match.id)) {
      this.editingKickoffMatch.set(null);
      this.kickoffErrorMessage.set(null);
    }
  }

  protected confirmKickoffChange(confirmation: KickoffChangeConfirmation): void {
    const match = this.editingKickoffMatch();

    if (!match || this.savingIds().has(match.id)) {
      return;
    }

    this.setSaving(match.id, true);
    this.errorMessage.set(null);
    this.kickoffErrorMessage.set(null);

    this.adminMatchesApi.updateKickoff(match.id, confirmation).subscribe({
      next: ({ match: updatedMatch }) => {
        this.matches.update((matches) =>
          matches.map((currentMatch) => (currentMatch.id === updatedMatch.id ? updatedMatch : currentMatch))
        );
        this.editingKickoffMatch.set(null);
        this.importMessage.set(
          !match.odds && updatedMatch.odds
            ? this.translations.translate('ui.match_p0_details_and_odds_saved', { p0: updatedMatch.matchNumber })
            : this.translations.translate('ui.match_p0_details_saved', { p0: updatedMatch.matchNumber })
        );
        this.ensureSelectedFilterHasResults();
        this.setSaving(match.id, false);
      },
      error: (error: unknown) => {
        const message =
          error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
            ? error.error.message
            : this.translations.translate("ui.match_details_could_not_be_saved");

        if (error instanceof HttpErrorResponse && [400, 403].includes(error.status)) {
          this.kickoffErrorMessage.set(message);
        } else {
          this.errorMessage.set(message);
          this.editingKickoffMatch.set(null);
        }

        this.setSaving(match.id, false);
      }
    });
  }

  protected isKickoffChangeSubmitting(): boolean {
    const match = this.editingKickoffMatch();

    return match ? this.savingIds().has(match.id) : false;
  }

  protected cancelSecretAction(): void {
    if (!this.isPendingSecretActionSubmitting()) {
      this.pendingSecretAction.set(null);
      this.pendingReleaseRoundLabel.set(null);
      this.pendingPostponedMatch.set(null);
      this.secretCodeErrorMessage.set(null);
    }
  }

  protected confirmSecretAction(secretCode: string): void {
    const pendingAction = this.pendingSecretAction();

    if (pendingAction === 'schedule') {
      this.importMatches(secretCode);
      return;
    }

    if (pendingAction === 'schedule-with-odds') {
      this.importMatchesWithOdds(secretCode);
      return;
    }

    if (pendingAction === 'release-round') {
      this.releaseRound(secretCode);
      return;
    }

    if (pendingAction === 'postponed') {
      this.updatePostponed(secretCode);
      return;
    }

    if (pendingAction === 'odds') {
      this.syncOdds(secretCode);
    }
  }

  protected isPendingSecretActionSubmitting(): boolean {
    const pendingAction = this.pendingSecretAction();

    return (
      (pendingAction === 'schedule' && this.importing()) ||
      (pendingAction === 'odds' && this.syncingOdds()) ||
      (pendingAction === 'schedule-with-odds' && this.importingWithOdds()) ||
      (pendingAction === 'release-round' && this.releasingRound()) ||
      (pendingAction === 'postponed' && this.pendingPostponedMatch() !== null && this.savingIds().has(this.pendingPostponedMatch()!.id))
    );
  }

  protected secretActionTitle(): string {
    const pendingAction = this.pendingSecretAction();

    if (pendingAction === 'odds') {
      return this.translations.translate("ui.confirm_odds_sync");
    }

    if (pendingAction === 'schedule-with-odds') {
      return this.translations.translate("ui.confirm_fixture_and_odds_sync");
    }

    if (pendingAction === 'release-round') {
      return this.translations.translate("ui.confirm_week_release");
    }

    if (pendingAction === 'postponed') {
      return this.pendingPostponedMatch()?.isPostponed ? this.translations.translate("ui.confirm_match_restore") : this.translations.translate("ui.confirm_match_postponement");
    }

    return this.translations.translate("ui.confirm_schedule_sync");
  }

  protected secretActionConfirmLabel(): string {
    const pendingAction = this.pendingSecretAction();

    if (pendingAction === 'postponed') {
      return this.pendingPostponedMatch()?.isPostponed ? this.translations.translate("ui.restore_match") : this.translations.translate("ui.mark_postponed");
    }

    if (pendingAction === 'release-round') {
      return this.translations.translate("ui.release_week");
    }

    return this.translations.translate("ui.start_sync");
  }

  private importMatches(secretCode: string): void {
    if (this.importing()) {
      return;
    }

    this.importing.set(true);
    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);

    this.adminMatchesApi.importMatches({ secretCode }).subscribe({
      next: ({ imported, validation, matches }) => {
        this.setMatches(matches);
        this.importMessage.set([this.translations.translate('ui.p0_matches_imported', { p0: imported }), validation ? validationMessage(validation, this.translations) : null].filter(Boolean).join(' '));
        this.pendingSecretAction.set(null);
        this.importing.set(false);
      },
      error: (error: unknown) => {
        this.handleSecretActionError(error, this.translations.translate("ui.matches_could_not_be_imported"));
        this.importing.set(false);
      }
    });
  }

  private syncOdds(secretCode: string): void {
    if (this.syncingOdds()) {
      return;
    }

    this.syncingOdds.set(true);
    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);

    this.adminMatchesApi.syncOdds({ secretCode }).subscribe({
      next: ({ synced, skippedExisting, skippedFinished, skippedUnresolved, unmatched, matches }) => {
        this.setMatches(matches);
        this.importMessage.set(
          [
            this.translations.translate('ui.p0_new_match_odds_synced', { p0: synced }),
            skippedExisting > 0 ? this.translations.translate('ui.p0_skipped_because_odds_already_exist', { p0: skippedExisting }) : null,
            skippedFinished > 0 ? this.translations.translate('ui.p0_skipped_because_matches_are_finished', { p0: skippedFinished }) : null,
            skippedUnresolved > 0 ? this.translations.translate('ui.p0_skipped_because_teams_are_still_placeholders', { p0: skippedUnresolved }) : null,
            unmatched > 0 ? this.translations.translate('ui.p0_eligible_matches_were_not_found_in_the_odds_source', { p0: unmatched }) : null
          ]
            .filter(message => message !== null).join(' ')
        );
        this.pendingSecretAction.set(null);
        this.syncingOdds.set(false);
      },
      error: (error: unknown) => {
        this.handleSecretActionError(error, this.translations.translate("ui.odds_could_not_be_synced_from_game_365"));
        this.syncingOdds.set(false);
      }
    });
  }

  private importMatchesWithOdds(secretCode: string): void {
    if (this.importingWithOdds()) {
      return;
    }

    this.importingWithOdds.set(true);
    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);

    this.adminMatchesApi.importMatchesWithOdds({ secretCode }).subscribe({
      next: ({ imported, odds, validation, matches }) => {
        this.setMatches(matches);
        this.importMessage.set(
          [
            this.translations.translate('ui.p0_matches_imported', { p0: imported }),
            this.translations.translate('ui.p0_new_match_odds_synced', { p0: odds.synced }),
            odds.skippedExisting > 0 ? this.translations.translate('ui.p0_skipped_because_odds_already_exist', { p0: odds.skippedExisting }) : null,
            odds.skippedFinished > 0 ? this.translations.translate('ui.p0_skipped_because_matches_are_finished', { p0: odds.skippedFinished }) : null,
            odds.skippedUnresolved > 0 ? this.translations.translate('ui.p0_skipped_because_teams_are_still_placeholders', { p0: odds.skippedUnresolved }) : null,
            odds.unmatched > 0 ? this.translations.translate('ui.p0_eligible_matches_were_not_found_in_the_odds_source', { p0: odds.unmatched }) : null,
            validationMessage(validation, this.translations)
          ]
            .filter(message => message !== null).join(' ')
        );
        this.pendingSecretAction.set(null);
        this.importingWithOdds.set(false);
      },
      error: (error: unknown) => {
        this.handleSecretActionError(error, this.translations.translate("ui.matches_and_odds_could_not_be_synced_from_game_365"));
        this.importingWithOdds.set(false);
      }
    });
  }

  private releaseRound(secretCode: string): void {
    const roundLabel = this.pendingReleaseRoundLabel();

    if (!roundLabel) {
      return;
    }

    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);
    this.releasingRound.set(true);

    this.adminMatchesApi.releaseRound({ roundLabel, secretCode }).subscribe({
      next: ({ released, validation, matches }) => {
        this.setMatches(matches);
        this.importMessage.set(this.translations.translate('ui.p0_matches_released_for_predictions_p1', { p0: released, p1: validationMessage(validation, this.translations) }));
        this.pendingSecretAction.set(null);
        this.pendingReleaseRoundLabel.set(null);
        this.releasingRound.set(false);
      },
      error: (error: unknown) => {
        const message =
          error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
            ? error.error.message
            : this.translations.translate("ui.week_could_not_be_released");

        if (error instanceof HttpErrorResponse && error.status === 403) {
          this.secretCodeErrorMessage.set(message);
          this.releasingRound.set(false);
          return;
        }

        if (error instanceof HttpErrorResponse && error.status === 409 && error.error?.validation) {
          this.errorMessage.set(`${message} ${validationMessage(error.error.validation as MatchImportValidation, this.translations)}`);
        } else {
          this.errorMessage.set(message);
        }

        this.pendingSecretAction.set(null);
        this.pendingReleaseRoundLabel.set(null);
        this.releasingRound.set(false);
      }
    });
  }

  private updatePostponed(secretCode: string): void {
    const match = this.pendingPostponedMatch();

    if (!match) {
      return;
    }

    this.setSaving(match.id, true);
    this.errorMessage.set(null);
    this.importMessage.set(null);
    this.secretCodeErrorMessage.set(null);

    this.adminMatchesApi.updatePostponed(match.id, { isPostponed: !match.isPostponed, secretCode }).subscribe({
      next: ({ match: updatedMatch }) => {
        this.matches.update((matches) => matches.map((currentMatch) => (currentMatch.id === updatedMatch.id ? updatedMatch : currentMatch)));
        this.importMessage.set(this.translations.translate('ui.match_p0_p1', { p0: updatedMatch.matchNumber, p1: updatedMatch.isPostponed ? this.translations.translate("ui.marked_as_postponed") : this.translations.translate('ui.restored') }));
        this.pendingSecretAction.set(null);
        this.pendingPostponedMatch.set(null);
        this.ensureSelectedFilterHasResults();
        this.setSaving(match.id, false);
      },
      error: (error: unknown) => {
        const message =
          error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
            ? error.error.message
            : this.translations.translate("ui.match_postponed_status_could_not_be_updated");

        if (error instanceof HttpErrorResponse && error.status === 403) {
          this.secretCodeErrorMessage.set(message);
        } else {
          this.errorMessage.set(message);
          this.pendingSecretAction.set(null);
          this.pendingPostponedMatch.set(null);
        }

        this.setSaving(match.id, false);
      }
    });
  }

  protected updateDraft(matchId: number, side: keyof ScoreDraft, value: string): void {
    const match = this.matches().find((currentMatch) => currentMatch.id === matchId);

    if (match?.isPostponed) {
      return;
    }

    this.drafts.update((drafts) => updateScoreDraft(drafts, matchId, side, value));
    this.queueSave(matchId);
  }

  protected setFilter(filter: MatchFilter): void {
    this.selectedFilter.set(filter);
  }

  protected isRequiredAction(match: Match): boolean {
    return isRequiredAction(match);
  }

  private queueSave(matchId: number): void {
    const match = this.matches().find((currentMatch) => currentMatch.id === matchId);
    const draft = this.drafts()[matchId];

    if (!match || match.isPostponed || !isValidScore(draft?.home) || !isValidScore(draft?.away)) {
      return;
    }

    if (match.finalScore?.home === draft.home && match.finalScore.away === draft.away) {
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
        this.saveFinalScore(match, homeScore, awayScore);
      }, 500)
    );
  }

  private saveFinalScore(match: Match, homeScore: number, awayScore: number): void {
    this.setSaving(match.id, true);
    this.errorMessage.set(null);

    this.adminMatchesApi.updateFinalScore(match.id, { homeScore, awayScore }).subscribe({
      next: ({ match: updatedMatch }) => {
        this.matches.update((matches) =>
          matches.map((currentMatch) => (currentMatch.id === updatedMatch.id ? updatedMatch : currentMatch))
        );
        this.ensureSelectedFilterHasResults();
        this.setSaving(match.id, false);
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.final_score_could_not_be_saved"));
        this.setSaving(match.id, false);
      }
    });
  }

  private loadMatches(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.importMessage.set(null);

    this.adminMatchesApi.getMatches().subscribe({
      next: ({ matches, importMatchesWithOddsEnabled }) => {
        this.importMatchesWithOddsEnabled.set(importMatchesWithOddsEnabled);
        this.setMatches(matches);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.matches_could_not_be_loaded"));
        this.loading.set(false);
      }
    });
  }

  private setMatches(matches: Match[]): void {
    this.matches.set(matches);
    this.drafts.set(
      Object.fromEntries(
        matches.map((match) => [
          match.id,
          {
            home: match.finalScore?.home ?? null,
            away: match.finalScore?.away ?? null
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

  private ensureSelectedFilterHasResults(): void {
    if (this.selectedFilter() !== 'active' && filterMatches(this.matches(), this.selectedFilter()).length === 0) {
      this.selectedFilter.set('active');
    }
  }

  private handleSecretActionError(error: unknown, fallbackMessage: string): void {
    const message =
      error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message : fallbackMessage;

    this.importMessage.set(null);

    if (error instanceof HttpErrorResponse && error.status === 403) {
      this.secretCodeErrorMessage.set(message);
      return;
    }

    this.errorMessage.set(message);
    this.pendingSecretAction.set(null);
    this.pendingReleaseRoundLabel.set(null);
    this.pendingPostponedMatch.set(null);
  }
}

function groupMatches(matches: readonly Match[]): MatchGroup[] {
  const groups = new Map<string, Match[]>();

  for (const match of matches) {
    const label = match.groupName ? `Group ${match.groupName}` : match.roundLabel;
    groups.set(label, [...(groups.get(label) ?? []), match]);
  }

  return Array.from(groups, ([label, groupedMatches]) => ({
    label,
    releasedForPredictions: groupedMatches.every((match) => match.releasedForPredictions),
    matches: groupedMatches
  }));
}

function validationMessage(validation: MatchImportValidation, translations: TranslationService): string {
  if (validation.complete && validation.released) {
    return translations.translate('ui.p0_is_complete_and_released', { p0: validation.roundLabel });
  }

  const issues = [
    validation.incompleteMatchNumbers.length > 0 ? translations.translate('ui.incomplete_matches_p0', { p0: validation.incompleteMatchNumbers.join(', ') }) : null,
    validation.missingOddsMatchNumbers.length > 0 ? translations.translate('ui.missing_odds_p0', { p0: validation.missingOddsMatchNumbers.join(', ') }) : null,
    validation.missingTeamNames.length > 0 ? translations.translate('ui.missing_teams_p0', { p0: validation.missingTeamNames.join(', ') }) : null
  ].filter(message => message !== null);

  return issues.length > 0
    ? translations.translate('ui.p0_is_not_released_p1', { p0: validation.roundLabel, p1: issues.join(' ') })
    : translations.translate('ui.p0_is_ready_to_release', { p0: validation.roundLabel });
}

function getExistingTeamNames(matches: readonly Match[]): string[] {
  const teamNames = new Set<string>();

  for (const match of matches) {
    teamNames.add(match.homeTeam.name);
    teamNames.add(match.awayTeam.name);
  }

  return Array.from(teamNames).filter((teamName) => teamName.trim().length > 0);
}

function filterMatches(matches: readonly Match[], filter: MatchFilter): Match[] {
  if (filter === 'required') {
    return matches.filter((match) => isRequiredAction(match));
  }

  if (filter === 'inactive') {
    return matches.filter((match) => isInactive(match));
  }

  return matches.filter((match) => !isInactive(match));
}

function isRequiredAction(match: Match): boolean {
  const matchSettlementWindowMs = (2 * 60 + 15) * 60 * 1_000;

  return !match.isPostponed && match.finalScore === null && Date.now() - Date.parse(match.kickoffAt) >= matchSettlementWindowMs;
}

function isInactive(match: Match): boolean {
  const matchSettlementWindowMs = (2 * 60 + 15) * 60 * 1_000;

  return (match.finalScore !== null || match.isPostponed) && Date.now() - Date.parse(match.kickoffAt) >= matchSettlementWindowMs;
}
