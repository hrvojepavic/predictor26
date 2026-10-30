import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { AppStateService } from '@core/state/app-state.service';
import { PredictionSummaryService } from '@services/prediction-summary.service';
import { PredictionActionIconComponent } from '@shared/components/prediction-action-icon/prediction-action-icon.component';
import { PredictionCountBadgeComponent } from '@shared/components/prediction-count-badge/prediction-count-badge.component';
import { MatchesService } from '@services/matches.service';
import { PaymentsService } from '@services/payments.service';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { HomeLeaderboardComponent } from './home-leaderboard/home-leaderboard.component';
import { PaymentInfoModalComponent } from './payment-info-modal.component';

interface NextPredictionDeadline {
  readonly label: string;
  readonly remaining: string;
}

@Component({
  selector: 'app-home-page',
  imports: [HomeLeaderboardComponent, ModalShellComponent, PaymentInfoModalComponent, RouterLink, PredictionActionIconComponent, PredictionCountBadgeComponent],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss'
})
export class HomePageComponent {
  private readonly appState = inject(AppStateService);
  private readonly matchesService = inject(MatchesService);
  private readonly predictionSummary = inject(PredictionSummaryService);
  private readonly paymentsService = inject(PaymentsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly routeCompetitionSlug = toSignal(this.route.paramMap.pipe(map((params) => params.get('slug'))), {
    initialValue: this.route.snapshot.paramMap.get('slug')
  });

  protected readonly matches = this.matchesService.matches;
  protected readonly activeCompetition = this.appState.activeCompetition;
  protected readonly paymentInfo = this.paymentsService.paymentInfo;
  protected readonly postPredictionsRouterLink = computed(() => this.createCompetitionRouterLink('predictions'));
  protected readonly myPredictionsRouterLink = computed(() => this.createCompetitionRouterLink('my-predictions'));
  protected readonly matchDayRouterLink = computed(() => this.createCompetitionRouterLink('match-day'));
  protected readonly paymentModalOpen = signal(false);
  protected readonly showPaymentNotice = computed(() => {
    const user = this.appState.currentUser();

    return user !== null && !user.isVerified && this.paymentInfo()?.visible === true;
  });
  protected readonly now = this.predictionSummary.now;
  protected readonly nextPredictionDeadline = computed<NextPredictionDeadline | null>(() => {
    const now = this.now();
    const nextGroup = this.predictionSummary.nextGroup();

    if (!nextGroup) {
      return null;
    }

    return {
      label: getPredictionRoundLabel(nextGroup.label),
      remaining: getTimeRemaining(nextGroup.deadlineAt, now)
    };
  });
  protected readonly remainingPredictionsCount = this.predictionSummary.remainingCount;

  constructor() {
    effect(() => {
      if (this.appState.isLoggedIn() && this.appState.activeCompetition()) {
        untracked(() => this.loadMatches());
      }
    });

    effect(() => {
      const user = this.appState.currentUser();

      if (user !== null && this.appState.activeCompetition() && !user.isVerified) {
        untracked(() => this.loadPaymentInfo());
      }
    });
  }

  protected openPaymentModal(): void {
    this.paymentModalOpen.set(true);
  }

  protected closePaymentModal(): void {
    this.paymentModalOpen.set(false);
  }

  private createCompetitionRouterLink(section: string): readonly string[] {
    const slug = this.routeCompetitionSlug();

    return slug ? ['/competition', slug, section] : ['/'];
  }

  private loadMatches(): void {
    this.matchesService.ensureMatches()?.subscribe();
  }

  private loadPaymentInfo(): void {
    this.paymentsService.ensurePaymentInfo().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}

function getPredictionRoundLabel(label: string): string {
  const labels = new Map<string, string>([
    ['Group stage - Round 1', 'Round 1'],
    ['Group stage - Round 2', 'Round 2'],
    ['Group stage - Round 3', 'Round 3']
  ]);

  return labels.get(label) ?? label;
}

function getTimeRemaining(deadlineAt: string, now: number): string {
  const remainingMs = Date.parse(deadlineAt) - now;

  if (remainingMs <= 0) {
    return 'closed';
  }

  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}
