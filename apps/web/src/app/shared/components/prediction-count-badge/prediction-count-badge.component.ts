import { Component, input } from '@angular/core';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

@Component({
  selector: 'app-prediction-count-badge',
  imports: [TranslatePipe],
  template: `@if (count() > 0) { <span [attr.aria-label]="'ui.predictions_remaining' | translate: { count: count() }">{{ count() }}</span> }`,
  styleUrl: './prediction-count-badge.component.scss'
})
export class PredictionCountBadgeComponent {
  readonly count = input.required<number>();
}
