import type { LocalizedString } from '@models/content-localization.models';
import { LocalizedTextPipe } from '@shared/pipes/localized-text.pipe';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Component, inject, output, signal } from '@angular/core';

import { CompetitionsApiProvider } from '@services/providers/competitions-api.provider';

@Component({
  imports: [LocalizedTextPipe, TranslatePipe],
  selector: 'app-rules-modal',
  templateUrl: './rules-modal.component.html',
  styleUrl: './rules-modal.component.scss'
})
export class RulesModalComponent {
  private readonly competitionsApi = inject(CompetitionsApiProvider);

  readonly closeModal = output<void>();
  protected readonly rules = signal<LocalizedString[][]>([]);

  constructor() {
    this.competitionsApi.getDefaultCompetitionRules().subscribe({
      next: ({ rules }) => {
        this.rules.set(rules);
      },
      error: () => {
        this.rules.set([]);
      }
    });
  }

  protected close(): void {
    this.closeModal.emit();
  }
}
