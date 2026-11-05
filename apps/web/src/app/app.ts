import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AuthApiProvider } from '@services/providers/auth-api.provider';
import { AppStateService } from '@core/state/app-state.service';
import { NotificationBrowserAccountService } from '@services/notification-browser-account.service';
import { debugSetUser, debugFlush } from '@core/guards/debug-log';
import { FinalResultsService } from '@services/final-results.service';
import { AppHeaderComponent } from './layout/app-header/app-header.component';
import { AppFooterComponent } from './layout/app-footer/app-footer.component';
import { FinalResultsModalComponent } from './features/final-results/final-results-modal.component';
import { ModalShellComponent } from './shared/components/modal-shell/modal-shell.component';

@Component({
  selector: 'app-root',
  imports: [
    AppHeaderComponent,
    AppFooterComponent,
    FinalResultsModalComponent,
    ModalShellComponent,
    RouterOutlet
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly appState = inject(AppStateService);
  private readonly authApi = inject(AuthApiProvider);
  private readonly notificationBrowserAccount = inject(NotificationBrowserAccountService);
  protected readonly finalResults = inject(FinalResultsService);
  protected readonly routeActivated = signal(false);

  constructor() {
    this.refreshCurrentUser();
    effect(() => {
      const user = this.appState.currentUser();
      const token = this.appState.token();
      if (user && token) {
        untracked(() => { void this.notificationBrowserAccount.synchronize(user.id, token).catch(() => {}); });
      }
    });

    effect(() => {
      if (this.appState.currentUser() && this.appState.activeCompetition()) {
        untracked(() => this.finalResults.ensureFinalResults());
      }
    });
  }

  private refreshCurrentUser(): void {
    if (!this.appState.isLoggedIn()) {
      return;
    }

    this.authApi.getCurrentUser().subscribe({
      next: (user) => {
        this.appState.updateCurrentUser(user);
        debugSetUser(user.username);
        debugFlush();
      },
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.appState.clearSession();
        }
      }
    });
  }
}
