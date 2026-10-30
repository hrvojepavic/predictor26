import { Component, input } from '@angular/core';

@Component({
  selector: 'app-prediction-action-icon',
  template: '<span class="action-icon" [class.action-icon-post]="kind() === \'predict\'" [class.action-icon-list]="kind() === \'list\'" [class.action-icon-match-day]="kind() === \'match-day\'"><span></span><span></span></span>',
  styleUrl: './prediction-action-icon.component.scss',
  host: { 'aria-hidden': 'true', '[class.compact]': 'compact()' }
})
export class PredictionActionIconComponent {
  readonly kind = input.required<'predict' | 'list' | 'match-day'>();
  readonly compact = input(false);
}
