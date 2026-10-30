import { Component, computed, DestroyRef, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

import { AppStateService } from '@core/state/app-state.service';
import { FinalResultsService } from '@services/final-results.service';
import { CompetitionsService } from '@services/competitions.service';
import { MatchesService } from '@services/matches.service';
import { PredictionSummaryService } from '@services/prediction-summary.service';
import { PredictionActionIconComponent } from '@shared/components/prediction-action-icon/prediction-action-icon.component';
import { PredictionCountBadgeComponent } from '@shared/components/prediction-count-badge/prediction-count-badge.component';
import { TooltipComponent } from '@shared/components/tooltip/tooltip.component';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';

@Component({
  selector: 'app-header',
  imports: [RouterLink, TooltipComponent, ModalShellComponent, PredictionActionIconComponent, PredictionCountBadgeComponent],
  host: { '(document:keydown)': 'onMenuKeydown($event)' },
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss'
})
export class AppHeaderComponent {
  protected readonly appState = inject(AppStateService);
  protected readonly finalResults = inject(FinalResultsService);
  protected readonly predictionSummary = inject(PredictionSummaryService);
  private readonly competitionsService = inject(CompetitionsService);
  private readonly matchesService = inject(MatchesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly currentUrl = signal(this.router.url);
  private readonly document = inject(DOCUMENT);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly menuToggle = viewChild<ElementRef<HTMLButtonElement>>('menuToggle');
  protected readonly menuOpen = signal(false);

  protected readonly routeCompetition = computed(() => {
    const competition = this.appState.activeCompetition();

    if (!competition) {
      return null;
    }

    const path = this.currentUrl().split('?')[0].split('#')[0];
    const competitionPath = `/competition/${competition.slug}`;

    return path === competitionPath || path.startsWith(`${competitionPath}/`) ? competition : null;
  });
  protected readonly brandRouterLink = computed(() => {
    const competition = this.routeCompetition();

    return competition ? ['/competition', competition.slug] : ['/'];
  });
  protected readonly brandState = computed(() => (this.routeCompetition() ? undefined : { showCompetitionList: true }));

  constructor() {
    effect(() => {
      if (this.menuOpen() && this.routeCompetition() && this.appState.currentUser()) {
        untracked(() => this.matchesService.ensureMatches()?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe());
      }
    });
    effect((onCleanup) => {
      if (!this.menuOpen()) {
        return;
      }

      // Keep background content out of keyboard and assistive-technology navigation.
      const background: { element: HTMLElement; inert: boolean }[] = [];
      let branch: HTMLElement = this.element.nativeElement;
      while (branch.parentElement && branch !== this.document.body) {
        for (const sibling of Array.from(branch.parentElement.children)) {
          if (sibling !== branch && sibling instanceof HTMLElement) {
            background.push({ element: sibling, inert: sibling.inert });
            sibling.inert = true;
          }
        }
        branch = branch.parentElement;
      }
      const previousOverflow = this.document.body.style.overflow;
      this.document.body.style.overflow = 'hidden';
      onCleanup(() => {
        this.document.body.style.overflow = previousOverflow;
        for (const item of background) {
          item.element.inert = item.inert;
        }
      });
    });
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        this.closeMenu();
        this.currentUrl.set(event.urlAfterRedirects);
      });
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    this.menuToggle()?.nativeElement.focus();
  }

  protected closeMenu(): void {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      this.menuToggle()?.nativeElement.focus();
    }
  }

  protected openFinalResults(): void {
    this.closeMenu();
    this.finalResults.openFinalResults();
  }

  protected logout(): void {
    this.closeMenu();
    this.competitionsService.clearCompetitions();
    this.appState.clearSession();
    void this.router.navigateByUrl('/login');
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    if (!this.menuOpen()) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu();
    } else if (event.key === 'Tab') {
      const controls = Array.from(this.element.nativeElement.querySelectorAll<HTMLElement>(
        '.menu-toggle, .menu-content a[href], .menu-content button, .menu-content [tabindex="0"]'
      ));
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = this.document.activeElement;
      if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !controls.includes(active as HTMLElement))) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
}
