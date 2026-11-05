import { inject } from '@angular/core';
import { CanActivateFn, Navigation, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { Competition } from '@models/competition.models';
import { CompetitionsService } from '@services/competitions.service';

export const homeRedirectGuard: CanActivateFn = () => {
  const competitionsService = inject(CompetitionsService);
  const router = inject(Router);
  const navigation = router.currentNavigation();

  if (!shouldAutoEnterSingleCompetition(navigation)) {
    return true;
  }

  return competitionsService.refreshCompetitions().pipe(
    map(({ competitions }) => {
      const activeCompetitions = competitions.filter(isJoinedActiveCompetition);

      if (activeCompetitions.length !== 1) {
        return true;
      }

      const competition = activeCompetitions[0];
      competitionsService.enterCompetition(competition);

      return router.createUrlTree(['/competition', competition.slug]);
    }),
    catchError(() => of(true))
  );
};

function shouldAutoEnterSingleCompetition(navigation: Navigation | null): boolean {
  return Boolean(navigation && navigation.previousNavigation === null && navigation.extras.state?.['showCompetitionList'] !== true);
}

function isJoinedActiveCompetition(competition: Competition): boolean {
  return competition.isJoined && !competition.isFinished;
}
