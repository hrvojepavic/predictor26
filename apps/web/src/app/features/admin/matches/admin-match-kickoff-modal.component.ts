import { Component, computed, effect, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Match } from '@models/match.models';
import { FormFieldStateDirective } from '@shared/directives/form-field-state.directive';

export interface KickoffChangeConfirmation {
  readonly kickoffAt: string;
  readonly city: string;
  readonly venue: string;
  readonly homeWinOdds?: number;
  readonly drawOdds?: number;
  readonly awayWinOdds?: number;
  readonly secretCode: string;
}

@Component({
  selector: 'app-admin-match-kickoff-modal',
  imports: [ReactiveFormsModule, FormFieldStateDirective],
  templateUrl: './admin-match-kickoff-modal.component.html',
  styleUrl: './admin-match-kickoff-modal.component.scss'
})
export class AdminMatchKickoffModalComponent {
  private readonly formBuilder = inject(FormBuilder);

  readonly match = input.required<Match>();
  readonly errorMessage = input<string | null>(null);
  readonly isSubmitting = input(false);

  readonly confirmKickoffChange = output<KickoffChangeConfirmation>();
  readonly cancelModal = output<void>();

  protected readonly kickoffForm = this.formBuilder.nonNullable.group({
    kickoffAt: ['', Validators.required],
    venueDisplay: ['', [Validators.required, Validators.maxLength(160)]],
    homeWinOdds: [null as number | null],
    drawOdds: [null as number | null],
    awayWinOdds: [null as number | null],
    secretCode: ['', [Validators.required, Validators.maxLength(128)]]
  });
  protected readonly canAddOdds = computed(() => this.match().odds === null && this.match().finalScore === null);

  constructor() {
    effect(() => {
      const match = this.match();

      this.kickoffForm.controls.kickoffAt.setValue(toLocalDateTimeInputValue(match.kickoffAt), { emitEvent: false });
      this.kickoffForm.controls.venueDisplay.setValue(toVenueDisplay(match.city, match.venue), { emitEvent: false });
      this.kickoffForm.controls.homeWinOdds.setValue(null, { emitEvent: false });
      this.kickoffForm.controls.drawOdds.setValue(null, { emitEvent: false });
      this.kickoffForm.controls.awayWinOdds.setValue(null, { emitEvent: false });
    });
  }

  protected confirm(): void {
    if (this.kickoffForm.invalid || this.isSubmitting()) {
      this.kickoffForm.markAllAsTouched();
      return;
    }

    const value = this.kickoffForm.getRawValue();
    const kickoffDate = new Date(value.kickoffAt);
    const venue = parseVenueDisplay(value.venueDisplay, this.match());
    const hasOddsInput = hasAnyOddsValue(value.homeWinOdds, value.drawOdds, value.awayWinOdds);
    const odds = this.canAddOdds()
      ? parseOdds(value.homeWinOdds, value.drawOdds, value.awayWinOdds)
      : null;

    if (Number.isNaN(kickoffDate.getTime())) {
      this.kickoffForm.controls.kickoffAt.setErrors({ invalid: true });
      return;
    }

    if (!venue) {
      this.kickoffForm.controls.venueDisplay.setErrors({ invalid: true });
      return;
    }

    if (this.canAddOdds() && hasOddsInput && !odds) {
      this.kickoffForm.controls.homeWinOdds.setErrors({ invalid: true });
      this.kickoffForm.controls.drawOdds.setErrors({ invalid: true });
      this.kickoffForm.controls.awayWinOdds.setErrors({ invalid: true });
      return;
    }

    this.confirmKickoffChange.emit({
      kickoffAt: kickoffDate.toISOString(),
      city: venue.city,
      venue: venue.venue,
      ...(odds ?? {}),
      secretCode: value.secretCode
    });
  }

  protected cancel(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.cancelModal.emit();
  }
}

function toLocalDateTimeInputValue(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return local.toISOString().slice(0, 16);
}

function toVenueDisplay(city: string, venue: string): string {
  return [city, venue].filter((part) => part.trim().length > 0).join(' · ');
}

function parseVenueDisplay(value: string, match: Match): Pick<Match, 'city' | 'venue'> | null {
  const normalized = value.trim().replace(/\s+·\s+/g, ' · ');

  if (normalized.length < 1 || normalized.length > 160) {
    return null;
  }

  const separatorIndex = normalized.indexOf('·');

  if (separatorIndex === -1) {
    return {
      city: match.city,
      venue: normalized
    };
  }

  const city = normalized.slice(0, separatorIndex).trim();
  const venue = normalized.slice(separatorIndex + 1).trim();

  if (city.length < 1 || venue.length < 1) {
    return null;
  }

  return { city, venue };
}

function parseOdds(
  homeWinOdds: number | null,
  drawOdds: number | null,
  awayWinOdds: number | null
): Pick<KickoffChangeConfirmation, 'homeWinOdds' | 'drawOdds' | 'awayWinOdds'> | null {
  if (!hasAnyOddsValue(homeWinOdds, drawOdds, awayWinOdds)) {
    return null;
  }

  if (!isValidOddsValue(homeWinOdds) || !isValidOddsValue(drawOdds) || !isValidOddsValue(awayWinOdds)) {
    return null;
  }

  return {
    homeWinOdds,
    drawOdds,
    awayWinOdds
  };
}

function hasAnyOddsValue(homeWinOdds: number | null, drawOdds: number | null, awayWinOdds: number | null): boolean {
  return homeWinOdds !== null || drawOdds !== null || awayWinOdds !== null;
}

function isValidOddsValue(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 1 && value <= 1000;
}
