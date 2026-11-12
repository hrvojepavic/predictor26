import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { CreateManualMatchRequest } from '@models/match.models';
import { FormFieldStateDirective } from '@shared/directives/form-field-state.directive';

export type ManualMatchConfirmation = CreateManualMatchRequest;

@Component({
  selector: 'app-admin-manual-match-modal',
  imports: [TranslatePipe, ReactiveFormsModule, FormFieldStateDirective],
  templateUrl: './admin-manual-match-modal.component.html',
  styleUrl: './admin-manual-match-modal.component.scss'
})
export class AdminManualMatchModalComponent {
  private readonly translations = inject(TranslationService);
  private readonly formBuilder = inject(FormBuilder);

  readonly existingTeamNames = input<readonly string[]>([]);
  readonly errorMessage = input<string | null>(null);
  readonly isSubmitting = input(false);

  readonly confirmManualMatch = output<ManualMatchConfirmation>();
  readonly cancelModal = output<void>();

  protected readonly homeLogoDataUrl = signal<string | null>(null);
  protected readonly awayLogoDataUrl = signal<string | null>(null);
  protected readonly homeLogoFileName = signal<string | null>(null);
  protected readonly awayLogoFileName = signal<string | null>(null);
  protected readonly logoErrorMessage = signal<string | null>(null);
  protected readonly sortedTeamNames = computed(() =>
    [...this.existingTeamNames()].sort((first, second) => first.localeCompare(second))
  );
  protected readonly matchForm = this.formBuilder.nonNullable.group({
    kickoffAt: ['', Validators.required],
    city: ['', [Validators.required, Validators.maxLength(80)]],
    venue: ['', [Validators.required, Validators.maxLength(120)]],
    homeUseNewTeam: [false],
    homeExistingTeam: [''],
    homeNewTeam: ['', [Validators.maxLength(80)]],
    awayUseNewTeam: [false],
    awayExistingTeam: [''],
    awayNewTeam: ['', [Validators.maxLength(80)]],
    homeWinOdds: ['', [Validators.required, Validators.pattern(oddsPattern)]],
    drawOdds: ['', [Validators.required, Validators.pattern(oddsPattern)]],
    awayWinOdds: ['', [Validators.required, Validators.pattern(oddsPattern)]],
    secretCode: ['', [Validators.required, Validators.maxLength(128)]]
  });

  protected async confirm(): Promise<void> {
    if (this.matchForm.invalid || this.isSubmitting()) {
      this.matchForm.markAllAsTouched();
      return;
    }

    const value = this.matchForm.getRawValue();
    const kickoffDate = new Date(value.kickoffAt);
    const homeTeamName = (value.homeUseNewTeam ? value.homeNewTeam : value.homeExistingTeam).trim();
    const awayTeamName = (value.awayUseNewTeam ? value.awayNewTeam : value.awayExistingTeam).trim();

    if (Number.isNaN(kickoffDate.getTime())) {
      this.matchForm.controls.kickoffAt.setErrors({ invalid: true });
      return;
    }

    if (!isValidTeamName(homeTeamName)) {
      this.matchForm.controls[value.homeUseNewTeam ? 'homeNewTeam' : 'homeExistingTeam'].setErrors({ required: true });
      return;
    }

    if (!isValidTeamName(awayTeamName)) {
      this.matchForm.controls[value.awayUseNewTeam ? 'awayNewTeam' : 'awayExistingTeam'].setErrors({ required: true });
      return;
    }

    if (normalizeTeamName(homeTeamName) === normalizeTeamName(awayTeamName)) {
      this.matchForm.controls.awayExistingTeam.setErrors({ sameTeam: true });
      this.matchForm.controls.awayNewTeam.setErrors({ sameTeam: true });
      return;
    }

    if (!isValidOddsValue(value.homeWinOdds)) {
      this.matchForm.controls.homeWinOdds.setErrors({ invalid: true });
      return;
    }

    if (!isValidOddsValue(value.drawOdds)) {
      this.matchForm.controls.drawOdds.setErrors({ invalid: true });
      return;
    }

    if (!isValidOddsValue(value.awayWinOdds)) {
      this.matchForm.controls.awayWinOdds.setErrors({ invalid: true });
      return;
    }

    this.confirmManualMatch.emit({
      kickoffAt: kickoffDate.toISOString(),
      city: value.city.trim(),
      venue: value.venue.trim(),
      homeTeamName,
      homeTeamLogoDataUrl: value.homeUseNewTeam ? this.homeLogoDataUrl() : null,
      awayTeamName,
      awayTeamLogoDataUrl: value.awayUseNewTeam ? this.awayLogoDataUrl() : null,
      homeWinOdds: Number(value.homeWinOdds),
      drawOdds: Number(value.drawOdds),
      awayWinOdds: Number(value.awayWinOdds),
      secretCode: value.secretCode
    });
  }

  protected cancel(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.cancelModal.emit();
  }

  protected async onLogoSelected(side: 'home' | 'away', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const dataUrlSignal = side === 'home' ? this.homeLogoDataUrl : this.awayLogoDataUrl;
    const fileNameSignal = side === 'home' ? this.homeLogoFileName : this.awayLogoFileName;

    dataUrlSignal.set(null);
    fileNameSignal.set(null);
    this.logoErrorMessage.set(null);

    if (!file) {
      return;
    }

    if (!allowedLogoTypes.has(file.type) || file.size > maxLogoSizeBytes) {
      input.value = '';
      this.logoErrorMessage.set(this.translations.translate("ui.use_png_jpg_or_webp_up_to_300_kb"));
      return;
    }

    try {
      dataUrlSignal.set(await readFileAsDataUrl(file));
      fileNameSignal.set(file.name);
    } catch {
      input.value = '';
      this.logoErrorMessage.set(this.translations.translate("ui.logo_could_not_be_read"));
    }
  }
}

const oddsPattern = /^(?:[1-9]\d{0,2})(?:\.\d{1,2})?$/;
const maxLogoSizeBytes = 300 * 1024;
const allowedLogoTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

function isValidTeamName(value: string): boolean {
  return value.length >= 1 && value.length <= 80;
}

function normalizeTeamName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isValidOddsValue(value: string): boolean {
  const odds = Number(value);

  return Number.isFinite(odds) && odds > 1 && odds <= 1000;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('File reader did not return a data URL.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('File reader failed.'));
    reader.readAsDataURL(file);
  });
}
