import { inject } from '@angular/core';
import { CanActivateFn, Navigation, Router } from '@angular/router';
import { catchError, map, of, tap } from 'rxjs';

import { Competition } from '@models/competition.models';
import { CompetitionsService } from '@services/competitions.service';
import { debugLog } from './debug-log';

export const homeRedirectGuard: CanActivateFn = () => {
  const competitionsService = inject(CompetitionsService);
  const router = inject(Router);
  const navigation = router.currentNavigation();

  const shouldAutoEnter = shouldAutoEnterSingleCompetition(navigation);
  debugLog(`[guard] shouldAutoEnter=${shouldAutoEnter}, prevNav=${navigation?.previousNavigation !== null}, state=${JSON.stringify(navigation?.extras.state)}`);

  if (!shouldAutoEnter) {
    debugLog('[guard] skipping auto-enter, returning true');
    return true;
  }

  return competitionsService.refreshCompetitions().pipe(
    tap(({ competitions }) => {
      debugLog(`[guard] fetched ${competitions.length} competitions: ${competitions.map(c => `${c.slug}(joined=${c.isJoined},finished=${c.isFinished})`).join(', ')}`);
    }),
    map(({ competitions }) => {
      const activeCompetitions = competitions.filter(isJoinedActiveCompetition);

      debugLog(`[guard] active joined: ${activeCompetitions.length}`);

      if (activeCompetitions.length !== 1) {
        debugLog('[guard] not exactly 1, returning true (show list)');
        return true;
      }

      const competition = activeCompetitions[0];
      competitionsService.enterCompetition(competition);

      debugLog(`[guard] auto-redirecting to /competition/${competition.slug}`);
      return router.createUrlTree(['/competition', competition.slug]);
    }),
    catchError((err) => {
      debugLog(`[guard] ERROR: ${err?.message ?? err}`);
      return of(true);
    })
  );
};

function shouldAutoEnterSingleCompetition(navigation: Navigation | null): boolean {
  return Boolean(navigation && navigation.previousNavigation === null && navigation.extras.state?.['showCompetitionList'] !== true);
}

function isJoinedActiveCompetition(competition: Competition): boolean {
  return competition.isJoined && !competition.isFinished;
}
