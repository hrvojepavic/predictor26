import { Component, input } from '@angular/core';

@Component({
  selector: 'app-prediction-count-badge',
  template: '@if (count() > 0) { <span [attr.aria-label]="count() + \' predictions remaining\'">{{ count() }}</span> }',
  styleUrl: './prediction-count-badge.component.scss'
})
export class PredictionCountBadgeComponent {
  readonly count = input.required<number>();
}
