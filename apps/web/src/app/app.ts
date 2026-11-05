import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationError, Router, RouterOutlet } from '@angular/router';

import { AuthApiProvider } from '@services/providers/auth-api.provider';
import { AppStateService } from '@core/state/app-state.service';
import { NotificationBrowserAccountService } from '@services/notification-browser-account.service';
import { debugLog, debugSetUser, debugFlush } from '@core/guards/debug-log';
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

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.refreshCurrentUser();

    // TEMPORARY: catch lazy chunk loading failures for debug
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationError) {
        debugLog(`[router] NavigationError url=${event.url}, error=${event.error?.message ?? event.error}`);
        const chunkMatch = String(event.error?.message ?? '').match(/https?:\/\/[^\s]+\.js/);
        if (chunkMatch) {
          const chunkUrl = chunkMatch[0];
          debugLog(`[diag] trying fetch("${chunkUrl}")...`);
          fetch(chunkUrl).then(
            (res) => {
              const ct = res.headers.get('content-type');
              debugLog(`[diag] fetch status=${res.status}, ok=${res.ok}, content-type="${ct}"`);
              res.text().then((body) => {
                const isHtml = body.trimStart().startsWith('<');
                debugLog(`[diag] isHtml=${isHtml}, length=${body.length}, first100: ${body.substring(0, 100)}`);
              });
            },
            (fetchErr) => debugLog(`[diag] fetch FAILED: ${fetchErr?.message ?? fetchErr}`)
          );
        }
      }
    });

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
