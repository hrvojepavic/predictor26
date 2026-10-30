import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { interval, map } from 'rxjs';
import { MatchesService } from '@services/matches.service';

@Injectable({ providedIn: 'root' })
export class PredictionSummaryService {
  private readonly matchesService = inject(MatchesService);
  readonly now = toSignal(interval(1_000).pipe(map(() => Date.now())), { initialValue: Date.now() });
  readonly nextGroup = computed(() => {
    const groups = new Map<string, string>();
    for (const match of this.matchesService.matches()) {
      if (match.isPostponed) continue;
      const deadline = groups.get(match.predictionRound);
      if (!deadline || Date.parse(match.predictionDeadlineAt) < Date.parse(deadline)) {
        groups.set(match.predictionRound, match.predictionDeadlineAt);
      }
    }
    return Array.from(groups, ([label, deadlineAt]) => ({ label, deadlineAt }))
      .filter(group => Date.parse(group.deadlineAt) > this.now())
      .sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt))[0] ?? null;
  });
  readonly remainingCount = computed(() => {
    const nextGroup = this.nextGroup();
    return nextGroup ? this.matchesService.matches().filter(match =>
      match.predictionRound === nextGroup.label && !match.isPostponed && match.prediction === null
    ).length : 0;
  });
}
