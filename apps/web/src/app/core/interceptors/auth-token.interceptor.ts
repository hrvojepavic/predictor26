import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { AppStateService } from '@core/state/app-state.service';

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const appState = inject(AppStateService);
  const token = appState.token();

  if (!token) {
    return next(req);
  }

  const activeCompetition = appState.activeCompetition();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };

  if (activeCompetition && !req.headers.has('X-Competition-Id')) {
    headers['X-Competition-Id'] = String(activeCompetition.id);
  }

  return next(
    req.clone({
      setHeaders: headers
    })
  );
};
