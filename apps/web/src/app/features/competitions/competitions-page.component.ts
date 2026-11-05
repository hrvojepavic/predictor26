import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { AppStateService } from '@core/state/app-state.service';
import { Competition } from '@models/competition.models';
import { CompetitionsService } from '@services/competitions.service';
import { CompetitionsApiProvider } from '@services/providers/competitions-api.provider';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { FormFieldStateDirective } from '@shared/directives/form-field-state.directive';

@Component({
  selector: 'app-competitions-page',
  imports: [FormFieldStateDirective, ModalShellComponent, ReactiveFormsModule],
  templateUrl: './competitions-page.component.html',
  styleUrl: './competitions-page.component.scss'
})
export class CompetitionsPageComponent {
  private readonly appState = inject(AppStateService);
  private readonly competitionsApi = inject(CompetitionsApiProvider);
  private readonly competitionsService = inject(CompetitionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly competitions = this.competitionsService.competitions;
  protected readonly loaded = this.competitionsService.loaded;
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly joinCompetitionPrompt = signal<Competition | null>(null);
  protected readonly joinErrorMessage = signal<string | null>(null);
  protected readonly joinRules = signal<string[]>([]);
  protected readonly loadingJoinRules = signal(false);
  protected readonly joiningCompetition = signal(false);
  protected readonly joinForm = this.formBuilder.nonNullable.group({
    passcode: ['', [Validators.required, Validators.maxLength(120)]]
  });

  constructor() {
    this.competitionsService.exitCompetition();
    this.competitionsService
      .refreshCompetitions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          this.errorMessage.set('Competitions could not be loaded.');
        }
      });
  }

  protected enterCompetition(competition: Competition): void {
    if (!this.appState.isLoggedIn()) {
      void this.router.navigate(['/login'], {
        queryParams: {
          returnUrl: '/'
        }
      });
      return;
    }

    if (!competition.isJoined) {
      this.joinErrorMessage.set(null);
      this.joinCompetitionPrompt.set(competition);
      this.joinForm.reset({ passcode: '' });
      this.loadJoinRules(competition.id);
      return;
    }

    this.competitionsService.enterCompetition(competition);
    void this.router.navigate(['/competition', competition.slug]);
  }

  protected cancelJoinCompetition(): void {
    if (!this.joiningCompetition()) {
      this.joinCompetitionPrompt.set(null);
      this.joinErrorMessage.set(null);
      this.joinRules.set([]);
      this.loadingJoinRules.set(false);
      this.joinForm.reset({ passcode: '' });
    }
  }

  protected confirmJoinCompetition(): void {
    const competition = this.joinCompetitionPrompt();

    if (!competition || this.joiningCompetition() || this.joinForm.invalid) {
      this.joinForm.markAllAsTouched();
      return;
    }

    this.joiningCompetition.set(true);
    this.joinErrorMessage.set(null);

    this.competitionsService.joinCompetition(competition, this.joinForm.getRawValue().passcode).subscribe({
      next: ({ competition: joinedCompetition }) => {
        this.joiningCompetition.set(false);
        this.joinCompetitionPrompt.set(null);
        this.joinRules.set([]);
        this.joinForm.reset({ passcode: '' });
        void this.router.navigate(['/competition', joinedCompetition.slug]);
      },
      error: (error: unknown) => {
        this.joinErrorMessage.set(
          error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
            ? error.error.message
            : 'Competition could not be joined.'
        );
        this.joiningCompetition.set(false);
      }
    });
  }

  private loadJoinRules(competitionId: number): void {
    this.loadingJoinRules.set(true);
    this.joinRules.set([]);

    this.competitionsApi
      .getCompetitionRulesById(competitionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ rules }) => {
          this.joinRules.set(rules);
          this.loadingJoinRules.set(false);
        },
        error: () => {
          this.joinRules.set([]);
          this.loadingJoinRules.set(false);
        }
      });
  }
}
