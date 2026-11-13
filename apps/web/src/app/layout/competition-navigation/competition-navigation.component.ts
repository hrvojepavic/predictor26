import { Location } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AppStateService } from '@core/state/app-state.service';
import { MatchesService } from '@services/matches.service';
import { PredictionSummaryService } from '@services/prediction-summary.service';
import { PredictionActionIconComponent } from '@shared/components/prediction-action-icon/prediction-action-icon.component';
import { PredictionCountBadgeComponent } from '@shared/components/prediction-count-badge/prediction-count-badge.component';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

@Component({
  selector: 'app-competition-navigation',
  imports: [RouterLink, RouterLinkActive, TranslatePipe, PredictionActionIconComponent, PredictionCountBadgeComponent],
  templateUrl: './competition-navigation.component.html',
  styleUrl: './competition-navigation.component.scss'
})
export class CompetitionNavigationComponent {
  private readonly appState = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly matches = inject(MatchesService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly summary = inject(PredictionSummaryService);
  private readonly initialUrl = this.router.navigated ? this.router.url : inject(Location).path();
  private readonly initiallyNavigated = this.router.navigated;
  private readonly navigationEnd = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd)
  ));
  private readonly segments = computed(() => this.router.parseUrl(
    this.navigationEnd()?.urlAfterRedirects ?? this.initialUrl
  ).root.children['primary']?.segments);
  protected readonly visible = computed(() => this.appState.isLoggedIn()
    && this.segments()?.[0]?.path === 'competition' && !!this.segments()?.[1]?.path);
  protected readonly loading = computed(() => this.visible()
    && ((!this.initiallyNavigated && !this.navigationEnd()) || !this.competition()));
  protected readonly competition = computed(() => {
    const competition = this.appState.activeCompetition();
    const segments = this.segments();
    return this.appState.isLoggedIn() && competition && segments?.[0]?.path === 'competition'
      && segments[1]?.path === competition.slug ? competition : null;
  });
  protected readonly items = [
    { section: '', key: 'ui.rankings', icon: 'rankings' },
    { section: 'predictions', key: 'ui.predict', icon: 'predict' },
    { section: 'my-predictions', key: 'ui.my_predictions', icon: 'list' },
    { section: 'match-day', key: 'ui.match_day', icon: 'match-day' }
  ] as const;
  protected readonly activeIndex = computed(() => this.items.findIndex(item =>
    item.section === (this.segments()?.[2]?.path ?? '') && this.segments()?.length === (item.section ? 3 : 2)));
  protected readonly activeOptions = { paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' } as const;

  constructor() {
    effect(() => {
      if (this.competition()) {
        untracked(() => this.matches.ensureMatches()?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe());
      }
    });
  }
}
