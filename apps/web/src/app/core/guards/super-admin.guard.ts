import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppStateService } from '@core/state/app-state.service';

export const superAdminGuard: CanActivateFn = () =>
  inject(AppStateService).currentUser()?.role === 'super_admin' || inject(Router).createUrlTree(['/admin']);
