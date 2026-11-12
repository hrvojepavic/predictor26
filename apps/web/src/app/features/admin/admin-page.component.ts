import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AppStateService } from '@core/state/app-state.service';
import { AdminRuleTemplate } from '@models/competition.models';
import { Competition } from '@models/competition.models';
import { CompetitionsService } from '@services/competitions.service';
import { CompetitionsApiProvider } from '@services/providers/competitions-api.provider';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { SecretCodeModalComponent } from '@shared/components/secret-code-modal/secret-code-modal.component';

@Component({
  selector: 'app-admin-page',
  imports: [TranslatePipe, ModalShellComponent, ReactiveFormsModule, RouterLink, SecretCodeModalComponent],
  templateUrl: './admin-page.component.html',
  styleUrl: './admin-page.component.scss'
})
export class AdminPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly appState = inject(AppStateService);
  private readonly competitionsApi = inject(CompetitionsApiProvider);
  private readonly competitionsService = inject(CompetitionsService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly activeCompetition = this.appState.activeCompetition;
  protected readonly isSuperAdmin = computed(() => this.appState.currentUser()?.role === 'super_admin');
  protected readonly competitions = this.competitionsService.competitions;
  protected readonly loadingCompetitions = signal(true);
  protected readonly loadingRuleTemplates = signal(true);
  protected readonly creatingCompetition = signal(false);
  protected readonly competitionErrorMessage = signal<string | null>(null);
  protected readonly createSuccessMessage = signal<string | null>(null);
  protected readonly createSecretCodeErrorMessage = signal<string | null>(null);
  protected readonly createCompetitionModalOpen = signal(false);
  protected readonly createSecretPromptOpen = signal(false);
  protected readonly createLogoPreview = signal<string | null>(null);
  protected readonly ruleTemplates = signal<AdminRuleTemplate[]>([]);
  protected readonly createForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    logoUrl: ['', [Validators.maxLength(200000)]],
    passcode: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(120)]],
    isFinished: [false],
    playoffsEnabled: [false],
    importMatchesWithOddsEnabled: [false],
    oddsSourceUrl: ['', [Validators.required, Validators.maxLength(500)]],
    rules: this.formBuilder.array<
      ReturnType<AdminPageComponent['createRuleControl']>
    >([])
  });

  protected get ruleControls() {
    return this.createForm.controls.rules.controls;
  }

  constructor() {
    this.competitionsService.refreshAdminCompetitions().subscribe({
      next: ({ competitions }) => {
        this.loadingCompetitions.set(false);
      },
      error: () => {
        this.competitionErrorMessage.set(this.translations.translate("ui.competitions_could_not_be_loaded"));
        this.loadingCompetitions.set(false);
      }
    });

    if (this.isSuperAdmin()) {
      this.competitionsApi.getAdminRuleTemplates().subscribe({
        next: ({ templates }) => {
          this.ruleTemplates.set(templates);
          this.createForm.setControl(
            'rules',
            this.formBuilder.array(templates.map((template) => this.createRuleControl(template)))
          );
          this.loadingRuleTemplates.set(false);
        },
        error: () => {
          this.competitionErrorMessage.set(this.translations.translate("ui.rule_templates_could_not_be_loaded"));
          this.loadingRuleTemplates.set(false);
        }
      });
    } else {
      this.loadingRuleTemplates.set(false);
    }
  }

  protected selectCompetition(competition: Competition): void {
    this.competitionsService.enterCompetition(competition);
    void this.router.navigate(['/admin/competition', competition.slug]);
  }

  protected openCreateCompetitionModal(): void {
    if (this.loadingRuleTemplates()) {
      return;
    }

    this.competitionErrorMessage.set(null);
    this.createSuccessMessage.set(null);
    this.createSecretCodeErrorMessage.set(null);
    this.createSecretPromptOpen.set(false);
    this.createCompetitionModalOpen.set(true);
  }

  protected cancelCreateCompetitionModal(): void {
    if (!this.creatingCompetition()) {
      this.createCompetitionModalOpen.set(false);
      this.createSecretPromptOpen.set(false);
      this.createSecretCodeErrorMessage.set(null);
    }
  }

  protected openCreateSecretCode(): void {
    if (this.createForm.invalid || this.creatingCompetition()) {
      this.competitionErrorMessage.set(this.translations.translate("ui.please_check_the_competition_details_and_selected_rule_values"));
      return;
    }

    this.competitionErrorMessage.set(null);
    this.createSuccessMessage.set(null);
    this.createSecretCodeErrorMessage.set(null);
    this.createSecretPromptOpen.set(true);
  }

  protected cancelCreateSecretCode(): void {
    if (!this.creatingCompetition()) {
      this.createSecretPromptOpen.set(false);
      this.createSecretCodeErrorMessage.set(null);
    }
  }

  protected confirmCreateSecretCode(secretCode: string): void {
    if (this.createForm.invalid || this.creatingCompetition()) {
      return;
    }

    const formValue = this.createForm.getRawValue();
    const rules = formValue.rules
      .filter((rule) => rule.isEnabled)
      .map((rule) => ({
        templateKey: rule.templateKey,
        value: rule.value || null
      }));

    this.creatingCompetition.set(true);
    this.competitionErrorMessage.set(null);
    this.createSuccessMessage.set(null);
    this.createSecretCodeErrorMessage.set(null);

    this.competitionsApi
      .createAdminCompetition({
        name: formValue.name,
        passcode: formValue.passcode,
        logoUrl: formValue.logoUrl,
        isFinished: formValue.isFinished,
        playoffsEnabled: formValue.playoffsEnabled,
        importMatchesWithOddsEnabled: formValue.importMatchesWithOddsEnabled,
        oddsSourceUrl: formValue.oddsSourceUrl,
        rules,
        secretCode
      })
      .subscribe({
        next: ({ competition }) => {
          this.competitionsService.refreshAdminCompetitions().subscribe();
          this.createForm.reset({
            name: '',
            logoUrl: '',
            passcode: '',
            isFinished: false,
            playoffsEnabled: false,
            importMatchesWithOddsEnabled: false,
            oddsSourceUrl: ''
          });
          this.createLogoPreview.set(null);
          this.resetRuleDefaults();
          this.createSuccessMessage.set(this.translations.translate('ui.p0_created', { p0: competition.name }));
          this.createCompetitionModalOpen.set(false);
          this.createSecretPromptOpen.set(false);
          this.creatingCompetition.set(false);
        },
        error: (error: unknown) => {
          const message =
            error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
              ? error.error.message
              : this.translations.translate("ui.competition_could_not_be_created");

          if (error instanceof HttpErrorResponse && error.status === 403) {
            this.createSecretCodeErrorMessage.set(message);
          } else {
            this.competitionErrorMessage.set(message);
            this.createSecretPromptOpen.set(false);
          }

          this.creatingCompetition.set(false);
        }
      });
  }

  protected importCreateLogo(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/') || file.size > 150000) {
      this.competitionErrorMessage.set(this.translations.translate("ui.logo_must_be_an_image_smaller_than_150_kb"));
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      this.createForm.controls.logoUrl.setValue(value);
      this.createLogoPreview.set(value || null);
      this.competitionErrorMessage.set(null);
    };
    reader.readAsDataURL(file);
  }

  protected removeCreateLogo(): void {
    this.createForm.controls.logoUrl.setValue('');
    this.createLogoPreview.set(null);
  }

  private createRuleControl(template: AdminRuleTemplate) {
    return this.formBuilder.nonNullable.group({
      templateKey: [template.key],
      isEnabled: [true],
      value: [template.defaultValue ?? '', template.valueLabel ? [Validators.required, Validators.maxLength(120)] : []]
    });
  }

  private resetRuleDefaults(): void {
    this.ruleControls.forEach((control, index) => {
      const template = this.ruleTemplates()[index];

      control.reset({
        templateKey: template.key,
        isEnabled: true,
        value: template.defaultValue ?? ''
      });
    });
  }
}
