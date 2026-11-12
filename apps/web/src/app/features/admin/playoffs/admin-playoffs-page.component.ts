import { TranslationService } from '@services/translation.service';
import { LocalizedDatePipe } from '@shared/pipes/localized-date.pipe';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Match, PlayoffMappingSide } from '@models/match.models';
import { CompetitionGroupTeam } from '@models/competition.models';
import { AppStateService } from '@core/state/app-state.service';
import { AdminMatchesApiProvider } from '@services/providers/admin-matches-api.provider';
import { CompetitionsApiProvider } from '@services/providers/competitions-api.provider';

interface TeamSlotContext {
  readonly match: Match;
  readonly side: PlayoffMappingSide;
  readonly placeholder: string;
  readonly selectedTeamName: string;
  readonly sourceLabel: string | null;
  readonly options: CompetitionGroupTeam[];
}

@Component({
  selector: 'app-admin-playoffs-page',
  imports: [TranslatePipe, LocalizedDatePipe, RouterLink],
  templateUrl: './admin-playoffs-page.component.html',
  styleUrl: './admin-playoffs-page.component.scss'
})
export class AdminPlayoffsPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly appState = inject(AppStateService);
  private readonly adminMatchesApi = inject(AdminMatchesApiProvider);
  private readonly competitionsApi = inject(CompetitionsApiProvider);

  protected readonly activeCompetition = this.appState.activeCompetition;
  protected readonly playoffsEnabled = computed(() => this.activeCompetition()?.playoffsEnabled === true);
  protected readonly matches = signal<Match[]>([]);
  protected readonly groupTeams = signal<CompetitionGroupTeam[]>([]);
  protected readonly loading = signal(true);
  protected readonly savingKeys = signal<ReadonlySet<string>>(new Set<string>());
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly playoffMatches = computed(() =>
    this.matches().filter((match) => !match.groupName || match.matchNumber > 72)
  );
  protected readonly contextsByMatch = computed(() =>
    Object.fromEntries(
      this.playoffMatches().map((match) => [match.id, [this.toSlotContext(match, 'home'), this.toSlotContext(match, 'away')]])
    )
  );

  constructor() {
    if (this.playoffsEnabled()) {
      this.loadData();
    } else {
      this.loading.set(false);
    }
  }

  protected updateMapping(context: TeamSlotContext, teamName: string): void {
    const key = slotKey(context.match.id, context.side);

    if (this.savingKeys().has(key)) {
      return;
    }

    const selectedTeam = teamName ? context.options.find((team) => team.name === teamName) : null;

    this.setSaving(key, true);
    this.errorMessage.set(null);
    this.successMessage.set(this.translations.translate('ui.saving_match_p0_p1_slot', { p0: context.match.matchNumber, p1: context.side === 'home' ? this.translations.translate('ui.home') : this.translations.translate('ui.away') }));

    this.adminMatchesApi
      .updatePlayoffMapping(context.match.id, {
        side: context.side,
        teamName: selectedTeam?.name ?? null,
        teamFlag: selectedTeam?.flag ?? null
      })
      .subscribe({
        next: ({ match }) => {
          this.matches.update((matches) => matches.map((currentMatch) => (currentMatch.id === match.id ? match : currentMatch)));
          this.successMessage.set(this.translations.translate('ui.match_p0_p1_slot_saved', { p0: match.matchNumber, p1: context.side === 'home' ? this.translations.translate('ui.home') : this.translations.translate('ui.away') }));
          this.setSaving(key, false);
        },
        error: () => {
          this.errorMessage.set(this.translations.translate("ui.playoff_mapping_could_not_be_saved"));
          this.setSaving(key, false);
        }
      });
  }

  protected isSaving(context: TeamSlotContext): boolean {
    return this.savingKeys().has(slotKey(context.match.id, context.side));
  }

  protected teamOptionLabel(team: CompetitionGroupTeam): string {
    const flag = team.flag && !/^(?:https:\/\/|\/)/i.test(team.flag) ? `${team.flag} ` : '';

    return `${flag}${team.name}`;
  }

  private loadData(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.adminMatchesApi.getMatches().subscribe({
      next: ({ matches }) => {
        this.matches.set(matches);
        this.competitionsApi.getCompetitionTeams().subscribe({
          next: ({ groupTeams }) => {
            this.groupTeams.set(groupTeams);
            this.loading.set(false);
          },
          error: () => {
            this.errorMessage.set(this.translations.translate("ui.teams_could_not_be_loaded"));
            this.loading.set(false);
          }
        });
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.playoff_matches_could_not_be_loaded"));
        this.loading.set(false);
      }
    });
  }

  private toSlotContext(match: Match, side: PlayoffMappingSide): TeamSlotContext {
    const team = side === 'home' ? match.homeTeam : match.awayTeam;
    const placeholder = team.placeholderName ?? team.name;
    const sourceLabel = getPlaceholderSourceLabel(placeholder);

    return {
      match,
      side,
      placeholder,
      selectedTeamName: team.placeholderName ? team.name : '',
      sourceLabel,
      options: this.groupTeams()
    };
  }

  private setSaving(key: string, saving: boolean): void {
    this.savingKeys.update((savingKeys) => {
      const nextSavingKeys = new Set(savingKeys);

      if (saving) {
        nextSavingKeys.add(key);
      } else {
        nextSavingKeys.delete(key);
      }

      return nextSavingKeys;
    });
  }
}

function getPlaceholderSourceLabel(placeholder: string): string | null {
  const groupName = getPlaceholderGroupName(placeholder);

  if (groupName) {
    return `Group ${groupName}`;
  }

  const sourceMatchNumber = getSourceMatchNumber(placeholder);

  return sourceMatchNumber ? `Match ${sourceMatchNumber}` : null;
}

function getPlaceholderGroupName(placeholder: string): string | null {
  const normalized = placeholder.trim().toUpperCase();
  const compactMatch = normalized.match(/^([A-L])\s*[1-4]$/) ?? normalized.match(/^[1-4]\s*([A-L])$/);

  if (compactMatch) {
    return compactMatch[1];
  }

  const phraseMatch = normalized.match(/GROUP\s+([A-L])/);

  return phraseMatch?.[1] ?? null;
}

function getSourceMatchNumber(placeholder: string): number | null {
  const normalized = placeholder.trim().toUpperCase();
  const compactMatch = normalized.match(/^[WL]\s*(\d{1,3})$/);

  if (compactMatch) {
    return Number(compactMatch[1]);
  }

  const phraseMatch = normalized.match(/\b(?:WINNER|LOSER)\b(?:\s+OF)?(?:\s+MATCH)?\s+(\d{1,3})\b/);

  return phraseMatch ? Number(phraseMatch[1]) : null;
}

function slotKey(matchId: number, side: PlayoffMappingSide): string {
  return `${matchId}:${side}`;
}
