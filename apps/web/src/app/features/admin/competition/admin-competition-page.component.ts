import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { AppStateService } from '@core/state/app-state.service';

@Component({
  selector: 'app-admin-competition-page',
  imports: [RouterLink],
  templateUrl: './admin-competition-page.component.html',
  styleUrl: './admin-competition-page.component.scss'
})
export class AdminCompetitionPageComponent {
  private readonly appState = inject(AppStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly routeCompetitionSlug = toSignal(this.route.paramMap.pipe(map((params) => params.get('slug'))), {
    initialValue: this.route.snapshot.paramMap.get('slug')
  });

  protected readonly activeCompetition = this.appState.activeCompetition;
  protected readonly setupRouterLink = computed(() => this.createAdminCompetitionRouterLink('setup'));
  protected readonly matchesRouterLink = computed(() => this.createAdminCompetitionRouterLink('matches'));
  protected readonly usersRouterLink = computed(() => this.createAdminCompetitionRouterLink('users'));
  protected readonly teamsRouterLink = computed(() => this.createAdminCompetitionRouterLink('teams'));
  protected readonly playoffsRouterLink = computed(() => this.createAdminCompetitionRouterLink('playoffs'));
  protected readonly paymentsRouterLink = computed(() => this.createAdminCompetitionRouterLink('payments'));
  protected readonly notificationsRouterLink = computed(() => this.createAdminCompetitionRouterLink('notifications'));
  protected readonly jobsRouterLink = computed(() => this.createAdminCompetitionRouterLink('jobs'));

  private createAdminCompetitionRouterLink(section: string): readonly string[] {
    const slug = this.routeCompetitionSlug();

    return slug ? ['/admin/competition', slug, section] : ['/admin'];
  }
}
