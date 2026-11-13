import { Component, input } from '@angular/core';

@Component({
  selector: 'app-prediction-action-icon',
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
      @switch (kind()) {
        @case ('rankings') { <path d="M3 20V11h5v9M9.5 20V4h5v16M16 20v-6h5v6M2 20h20" /> }
        @case ('predict') { <circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /> }
        @case ('list') { <path d="m3 6 1.5 1.5L7 5M10 6h11M3 12h4M10 12h11M3 18h4M10 18h11" /> }
        @case ('match-day') { <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 17h2" /> }
      }
    </svg>
  `,
  styleUrl: './prediction-action-icon.component.scss',
  host: { 'aria-hidden': 'true', '[class.compact]': 'compact()' }
})
export class PredictionActionIconComponent {
  readonly kind = input.required<'rankings' | 'predict' | 'list' | 'match-day'>();
  readonly compact = input(false);
}
