import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppStateService } from '@core/state/app-state.service';
import { PaymentsService } from '@services/payments.service';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { HomeLeaderboardComponent } from './home-leaderboard/home-leaderboard.component';
import { PaymentInfoModalComponent } from './payment-info-modal.component';

@Component({
  selector: 'app-home-page',
  imports: [TranslatePipe, HomeLeaderboardComponent, ModalShellComponent, PaymentInfoModalComponent],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss'
})
export class HomePageComponent {
  private readonly appState = inject(AppStateService);
  private readonly paymentsService = inject(PaymentsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly paymentInfo = this.paymentsService.paymentInfo;
  protected readonly paymentModalOpen = signal(false);
  protected readonly showPaymentNotice = computed(() => {
    const user = this.appState.currentUser();
    return user !== null && !user.isVerified && this.paymentInfo()?.visible === true;
  });

  constructor() {
    effect(() => {
      const user = this.appState.currentUser();
      if (user !== null && this.appState.activeCompetition() && !user.isVerified) {
        untracked(() => this.paymentsService.ensurePaymentInfo().pipe(takeUntilDestroyed(this.destroyRef)).subscribe());
      }
    });
  }
  protected openPaymentModal(): void { this.paymentModalOpen.set(true); }
  protected closePaymentModal(): void { this.paymentModalOpen.set(false); }
}
