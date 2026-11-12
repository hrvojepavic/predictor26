import { Routes } from '@angular/router';

import { adminCompetitionSlugGuard } from '@guards/admin-competition-slug.guard';
import { adminGuard } from '@guards/admin.guard';
import { authGuard } from '@guards/auth.guard';
import { competitionSlugGuard } from '@guards/competition-slug.guard';
import { guestGuard } from '@guards/guest.guard';
import { homeRedirectGuard } from '@guards/home-redirect.guard';
import { LoginPageComponent } from '@features/auth/login/login-page.component';
import { RegisterPageComponent } from '@features/auth/register/register-page.component';
import { RulesPageComponent } from '@features/rules/rules-page.component';

export const routes: Routes = [
  {
    path: 'competition/:slug/settings',
    canActivate: [authGuard, competitionSlugGuard],
    loadComponent: () =>
      import('./features/competition-settings/competition-settings-page.component').then(
        (component) => component.CompetitionSettingsPageComponent
      )
  },
  {
    path: '',
    canActivate: [authGuard, homeRedirectGuard],
    loadComponent: () =>
      import('./features/competitions/competitions-page.component').then(
        (component) => component.CompetitionsPageComponent
      )
  },
  {
    path: 'competition/:slug',
    canActivate: [authGuard, competitionSlugGuard],
    loadComponent: () =>
      import('./features/home/home-page.component').then((component) => component.HomePageComponent)
  },
  {
    path: 'competition/:slug/predictions',
    canActivate: [authGuard, competitionSlugGuard],
    loadComponent: () =>
      import('./features/predictions/predictions-page.component').then((component) => component.PredictionsPageComponent)
  },
  {
    path: 'competition/:slug/my-predictions',
    canActivate: [authGuard, competitionSlugGuard],
    loadComponent: () =>
      import('./features/my-predictions/my-predictions-page.component').then(
        (component) => component.MyPredictionsPageComponent
      )
  },
  {
    path: 'competition/:slug/match-day',
    canActivate: [authGuard, competitionSlugGuard],
    loadComponent: () =>
      import('./features/home/home-match-carousel/home-match-carousel.component').then(
        (component) => component.HomeMatchCarouselComponent
      )
  },
  {
    path: 'competition/:slug/stats',
    canActivate: [authGuard, competitionSlugGuard],
    loadComponent: () =>
      import('./features/stats/stats-page.component').then((component) => component.StatsPageComponent)
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    component: LoginPageComponent
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    component: RegisterPageComponent
  },
  {
    path: 'competition/:slug/rules',
    canActivate: [authGuard, competitionSlugGuard],
    component: RulesPageComponent
  },
  {
    path: 'competitions',
    redirectTo: '',
    pathMatch: 'full'
  },
  {
    path: 'predictions',
    redirectTo: '',
    pathMatch: 'full'
  },
  {
    path: 'my-predictions',
    redirectTo: '',
    pathMatch: 'full'
  },
  {
    path: 'match-day',
    redirectTo: '',
    pathMatch: 'full'
  },
  {
    path: 'stats',
    redirectTo: '',
    pathMatch: 'full'
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./features/admin/admin-page.component').then((component) => component.AdminPageComponent)
  },
  {
    path: 'admin/settings',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./features/admin/settings/admin-settings-page.component').then(
        (component) => component.AdminSettingsPageComponent
      )
  },
  {
    path: 'admin/competition/:slug',
    canActivate: [adminGuard, adminCompetitionSlugGuard],
    loadComponent: () =>
      import('./features/admin/competition/admin-competition-page.component').then(
        (component) => component.AdminCompetitionPageComponent
      )
  },
  {
    path: 'admin/competition/:slug/setup',
    canActivate: [adminGuard, adminCompetitionSlugGuard],
    loadComponent: () =>
      import('./features/admin/competition-setup/admin-competition-setup-page.component').then(
        (component) => component.AdminCompetitionSetupPageComponent
      )
  },
  {
    path: 'admin/competition/:slug/users',
    canActivate: [adminGuard, adminCompetitionSlugGuard],
    loadComponent: () =>
      import('./features/admin/users/admin-users-page.component').then((component) => component.AdminUsersPageComponent)
  },
  {
    path: 'admin/competition/:slug/teams',
    canActivate: [adminGuard, adminCompetitionSlugGuard],
    loadComponent: () =>
      import('./features/admin/teams/admin-teams-page.component').then((component) => component.AdminTeamsPageComponent)
  },
  {
    path: 'admin/competition/:slug/matches',
    canActivate: [adminGuard, adminCompetitionSlugGuard],
    loadComponent: () =>
      import('./features/admin/matches/admin-matches-page.component').then(
        (component) => component.AdminMatchesPageComponent
      )
  },
  {
    path: 'admin/competition/:slug/playoffs',
    canActivate: [adminGuard, adminCompetitionSlugGuard],
    loadComponent: () =>
      import('./features/admin/playoffs/admin-playoffs-page.component').then(
        (component) => component.AdminPlayoffsPageComponent
      )
  },
  {
    path: 'admin/competition/:slug/payments',
    canActivate: [adminGuard, adminCompetitionSlugGuard],
    loadComponent: () =>
      import('./features/admin/payments/admin-payments-page.component').then(
        (component) => component.AdminPaymentsPageComponent
      )
  },
  {
    path: 'admin/competition/:slug/notifications',
    canActivate: [adminGuard, adminCompetitionSlugGuard],
    loadComponent: () =>
      import('./features/admin/notifications/admin-notifications-page.component').then(
        (component) => component.AdminNotificationsPageComponent
      )
  },
  {
    path: 'admin/competition/:slug/jobs',
    canActivate: [adminGuard, adminCompetitionSlugGuard],
    loadComponent: () =>
      import('./features/admin/jobs/admin-jobs-page.component').then((component) => component.AdminJobsPageComponent)
  },
  {
    path: 'admin/competition',
    redirectTo: 'admin',
    pathMatch: 'full'
  },
  {
    path: 'admin/users',
    redirectTo: 'admin',
    pathMatch: 'full'
  },
  {
    path: 'admin/teams',
    redirectTo: 'admin',
    pathMatch: 'full'
  },
  {
    path: 'admin/matches',
    redirectTo: 'admin',
    pathMatch: 'full'
  },
  {
    path: 'admin/playoffs',
    redirectTo: 'admin',
    pathMatch: 'full'
  },
  {
    path: 'admin/payments',
    redirectTo: 'admin',
    pathMatch: 'full'
  },
  {
    path: 'admin/notifications',
    redirectTo: 'admin',
    pathMatch: 'full'
  },
  {
    path: 'admin/jobs',
    redirectTo: 'admin',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
