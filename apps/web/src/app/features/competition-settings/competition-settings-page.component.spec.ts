import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { AppStateService } from '@core/state/app-state.service';
import { CompetitionsService } from '@services/competitions.service';
import { Competition } from '@models/competition.models';
import { routes } from '../../app.routes';
import { CompetitionSettingsPageComponent } from './competition-settings-page.component';

@Component({ template: 'Destination' })
class DestinationStubComponent {}

describe('Competition settings navigation', () => {
  const loggedIn = signal(false);
  const activeCompetition = signal<Competition | null>(null);
  const competition = { id: 1, name: 'League', slug: 'league' } as Competition;

  beforeEach(() => {
    loggedIn.set(false);
    activeCompetition.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          routes.find(route => route.path === 'competition/:slug/settings')!,
          { path: 'login', component: DestinationStubComponent },
          { path: 'competitions', component: DestinationStubComponent }
        ]),
        { provide: AppStateService, useValue: { isLoggedIn: loggedIn, activeCompetition } },
        { provide: CompetitionsService, useValue: {
          refreshCompetitions: () => of({ competitions: [competition] }),
          enterCompetition: (value: Competition) => activeCompetition.set(value)
        } }
      ]
    });
  });

  it('resolves the competition on direct navigation', async () => {
    loggedIn.set(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/competition/league/settings', CompetitionSettingsPageComponent);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Settings');
    expect(activeCompetition()).toEqual(competition);
  });

  it('redirects a signed-out visitor to login', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/competition/league/settings', DestinationStubComponent);
    const router = TestBed.inject(Router);
    expect(router.url.split('?')[0]).toBe('/login');
    expect(router.parseUrl(router.url).queryParams['returnUrl']).toBe('/competition/league/settings');
  });

  it('redirects an unknown competition to competition selection', async () => {
    loggedIn.set(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/competition/unknown/settings', DestinationStubComponent);
    expect(TestBed.inject(Router).url).toBe('/competitions');
    expect(activeCompetition()).toBeNull();
  });
});
