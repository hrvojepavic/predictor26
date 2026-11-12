import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminTeam } from '@models/admin-team.models';
import { AdminTeamsApiProvider } from '@services/providers/admin-teams-api.provider';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { SecretCodeModalComponent } from '@shared/components/secret-code-modal/secret-code-modal.component';
import { AdminTeamLogoModalComponent, TeamLogoChangeConfirmation } from './admin-team-logo-modal.component';

interface PendingDisplayNameChange {
  readonly team: AdminTeam;
  readonly displayName: string;
}

interface TeamRow extends AdminTeam {
  readonly draftDisplayName: string;
  readonly initials: string;
  readonly isDisplayNameDirty: boolean;
  readonly isDisplayNameInvalid: boolean;
  readonly isUpdating: boolean;
}

@Component({
  selector: 'app-admin-teams-page',
  imports: [TranslatePipe, AdminTeamLogoModalComponent, ModalShellComponent, RouterLink, SecretCodeModalComponent],
  templateUrl: './admin-teams-page.component.html',
  styleUrl: './admin-teams-page.component.scss'
})
export class AdminTeamsPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly adminTeamsApi = inject(AdminTeamsApiProvider);

  protected readonly teams = signal<AdminTeam[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly displayNameErrorMessage = signal<string | null>(null);
  protected readonly logoErrorMessage = signal<string | null>(null);
  protected readonly displayNameDrafts = signal<Record<string, string>>({});
  protected readonly pendingDisplayNameChange = signal<PendingDisplayNameChange | null>(null);
  protected readonly editingLogoTeam = signal<AdminTeam | null>(null);
  protected readonly updatingTeamName = signal<string | null>(null);
  protected readonly sortedTeams = computed(() =>
    [...this.teams()].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }))
  );
  protected readonly teamRows = computed<TeamRow[]>(() => {
    const drafts = this.displayNameDrafts();
    const updatingTeamName = this.updatingTeamName();

    return this.sortedTeams().map((team) => {
      const draftDisplayName = drafts[team.normalizedName] ?? team.displayName;
      const trimmedDraftDisplayName = draftDisplayName.trim();

      return {
        ...team,
        draftDisplayName,
        initials: getInitials(team.name),
        isDisplayNameDirty: trimmedDraftDisplayName !== team.displayName,
        isDisplayNameInvalid: trimmedDraftDisplayName.length < 1 || trimmedDraftDisplayName.length > 140,
        isUpdating: updatingTeamName === team.normalizedName
      };
    });
  });

  constructor() {
    this.loadTeams();
  }

  protected updateDisplayNameDraft(normalizedName: string, event: Event): void {
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';

    this.displayNameDrafts.update((drafts) => ({
      ...drafts,
      [normalizedName]: value
    }));
  }

  protected requestDisplayNameSave(team: TeamRow): void {
    if (this.updatingTeamName()) {
      return;
    }

    const displayName = team.draftDisplayName.trim();

    if (displayName.length < 1 || displayName.length > 140 || displayName === team.displayName) {
      return;
    }

    this.errorMessage.set(null);
    this.displayNameErrorMessage.set(null);
    this.pendingDisplayNameChange.set({ team, displayName });
  }

  protected cancelDisplayNameChange(): void {
    if (!this.updatingTeamName()) {
      this.pendingDisplayNameChange.set(null);
      this.displayNameErrorMessage.set(null);
    }
  }

  protected confirmDisplayNameChange(secretCode: string): void {
    const pendingChange = this.pendingDisplayNameChange();

    if (!pendingChange || this.updatingTeamName()) {
      return;
    }

    const { team, displayName } = pendingChange;

    this.updatingTeamName.set(team.normalizedName);
    this.errorMessage.set(null);
    this.displayNameErrorMessage.set(null);

    this.adminTeamsApi.updateDisplayName(team.normalizedName, { displayName, secretCode }).subscribe({
      next: ({ team: updatedTeam }) => {
        const normalizedTeam = normalizeAdminTeam(updatedTeam);

        this.replaceTeam(normalizedTeam);
        this.displayNameDrafts.update((drafts) => ({
          ...drafts,
          [normalizedTeam.normalizedName]: normalizedTeam.displayName
        }));
        this.pendingDisplayNameChange.set(null);
        this.updatingTeamName.set(null);
      },
      error: (error: unknown) => {
        const message =
          error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
            ? error.error.message
            : this.translations.translate("ui.team_display_name_could_not_be_updated");

        if (error instanceof HttpErrorResponse && [400, 403, 404].includes(error.status)) {
          this.displayNameErrorMessage.set(message);
        } else {
          this.errorMessage.set(message);
          this.pendingDisplayNameChange.set(null);
        }

        this.updatingTeamName.set(null);
      }
    });
  }

  protected editLogo(team: AdminTeam): void {
    if (this.updatingTeamName()) {
      return;
    }

    this.errorMessage.set(null);
    this.logoErrorMessage.set(null);
    this.editingLogoTeam.set(team);
  }

  protected cancelLogoChange(): void {
    if (!this.updatingTeamName()) {
      this.editingLogoTeam.set(null);
      this.logoErrorMessage.set(null);
    }
  }

  protected confirmLogoChange(confirmation: TeamLogoChangeConfirmation): void {
    const team = this.editingLogoTeam();

    if (!team || this.updatingTeamName()) {
      return;
    }

    this.updatingTeamName.set(team.normalizedName);
    this.errorMessage.set(null);
    this.logoErrorMessage.set(null);

    this.adminTeamsApi.updateLogo(team.normalizedName, confirmation).subscribe({
      next: ({ team: updatedTeam }) => {
        this.replaceTeam(updatedTeam);
        this.editingLogoTeam.set(null);
        this.updatingTeamName.set(null);
      },
      error: (error: unknown) => {
        const message =
          error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
            ? error.error.message
            : this.translations.translate("ui.team_icon_could_not_be_updated");

        if (error instanceof HttpErrorResponse && [400, 403, 404].includes(error.status)) {
          this.logoErrorMessage.set(message);
        } else {
          this.errorMessage.set(message);
          this.editingLogoTeam.set(null);
        }

        this.updatingTeamName.set(null);
      }
    });
  }

  private loadTeams(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.adminTeamsApi.getTeams().subscribe({
      next: ({ teams }) => {
        const normalizedTeams = teams.map(normalizeAdminTeam);

        this.teams.set(normalizedTeams);
        this.displayNameDrafts.set(
          Object.fromEntries(normalizedTeams.map((team) => [team.normalizedName, team.displayName] satisfies [string, string]))
        );
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.teams_could_not_be_loaded"));
        this.loading.set(false);
      }
    });
  }

  private replaceTeam(updatedTeam: AdminTeam): void {
    const normalizedTeam = normalizeAdminTeam(updatedTeam);

    this.teams.update((teams) =>
      teams.map((currentTeam) => (currentTeam.normalizedName === normalizedTeam.normalizedName ? normalizedTeam : currentTeam))
    );
  }
}

function normalizeAdminTeam(team: AdminTeam): AdminTeam {
  const name = normalizeTeamText(team.name, normalizeTeamText(team.displayName, team.normalizedName));
  const displayName = normalizeTeamText(team.displayName, name);

  return {
    ...team,
    name,
    displayName
  };
}

function normalizeTeamText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return (parts.length > 0 ? parts.map((part) => part[0]).join('') : '?').toUpperCase();
}
