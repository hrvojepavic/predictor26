import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { AppStateService } from '@core/state/app-state.service';
import { CompetitionsService } from '@services/competitions.service';
import { Competition } from '@models/competition.models';
import { routes } from '../../app.routes';
import { CompetitionNotificationSettingsService } from '@services/competition-notification-settings.service';
import { NotificationRemindersService } from '@services/notification-reminders.service';
import { NotificationPreferencesResponse } from '@models/notification.models';
import { CompetitionSettingsPageComponent } from './competition-settings-page.component';

@Component({ template: 'Destination' })
class DestinationStubComponent {}

describe('Competition settings navigation', () => {
  const preferences = signal<NotificationPreferencesResponse | null>(null);
  const save = vi.fn();
  const addBrowser = vi.fn();
  const removeBrowser = vi.fn();
  const fingerprint = signal<string | null>(null);
  const loggedIn = signal(false);
  const activeCompetition = signal<Competition | null>(null);
  const competition = { id: 1, name: 'League', slug: 'league' } as Competition;

  beforeEach(() => {
    preferences.set(null);
    fingerprint.set(null);
    addBrowser.mockReset(); removeBrowser.mockReset();
    save.mockReset();
    save.mockImplementation(async (_id, value) => {
      preferences.set({ ...preferences()!, preferences: value });
      return true;
    });
    loggedIn.set(false);
    activeCompetition.set(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: CompetitionNotificationSettingsService, useValue: {
          settings: preferences, loading: signal(false), saving: signal(false), error: signal(null),
          save, addBrowser, removeBrowser,
          load: async () => { preferences.set({ browsers: [], preferences: { enabled: false, reminder9h: false, reminder1h: false }, competitionEnabled: true, eligible: true }); }
        } },
        { provide: NotificationRemindersService, useValue: {
          supported: true, fingerprint, refreshBrowserState: async () => {},
          enableReminders: async () => ({ status: 'subscribed', permission: 'granted' })
        } },
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

  it('has only two toggles and saves each change without a save button', async () => {
    loggedIn.set(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/competition/league/settings', CompetitionSettingsPageComponent);
    await harness.fixture.whenStable();
    const root=harness.routeNativeElement!;
    const toggles=Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(toggles).toHaveLength(2);
    expect(toggles.every(toggle=>!toggle.checked)).toBe(true);
    expect(root.textContent).not.toContain('Save preferences');
    expect(root.textContent).not.toContain('Enable all');
    toggles[0].click();
    await harness.fixture.whenStable();
    expect(save).toHaveBeenLastCalledWith(1,{enabled:true,reminder1h:true,reminder9h:false},true);
    toggles[1].click();
    await harness.fixture.whenStable();
    expect(save).toHaveBeenLastCalledWith(1,{enabled:true,reminder1h:true,reminder9h:true},true);
    toggles[0].click();
    await harness.fixture.whenStable();
    expect(save).toHaveBeenLastCalledWith(1,{enabled:true,reminder1h:false,reminder9h:true},false);
    toggles[1].click();
    await harness.fixture.whenStable();
    expect(save).toHaveBeenLastCalledWith(1,{enabled:false,reminder1h:false,reminder9h:false},false);
  });

  it('shows browsers, only offers adding a different browser, and never offers removing the last', async () => {
    loggedIn.set(true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/competition/league/settings', CompetitionSettingsPageComponent);
    await harness.fixture.whenStable();
    preferences.set({ ...preferences()!, preferences:{enabled:true,reminder1h:true,reminder9h:false}, browsers:[{id:1,name:'Chrome on Windows',fingerprint:'chrome'}] });
    await harness.fixture.whenStable();
    const root=harness.routeNativeElement!;
    expect(root.querySelector('.remove-browser')).toBeNull();
    expect(root.querySelector('.add-browser')).not.toBeNull();
    (root.querySelector('.add-browser') as HTMLButtonElement).click();
    expect(addBrowser).toHaveBeenCalledWith(1);
    fingerprint.set('chrome');
    await harness.fixture.whenStable();
    expect(root.querySelector('.add-browser')).toBeNull();
    expect(root.textContent).toContain('(this browser)');
    preferences.set({ ...preferences()!, browsers:[...preferences()!.browsers,{id:2,name:'Firefox on Linux',fingerprint:'firefox'}] });
    await harness.fixture.whenStable();
    expect(root.querySelectorAll('.remove-browser')).toHaveLength(2);
    (root.querySelectorAll('.remove-browser')[1] as HTMLButtonElement).click();
    expect(removeBrowser).toHaveBeenCalledWith(1,2);
    save.mockImplementation(async (_id, value) => {
      preferences.set({ ...preferences()!, preferences: value, browsers: value.enabled
        ? [{id:1,name:'Chrome on Windows',fingerprint:'chrome'}] : [] });
      return true;
    });
    const firstToggle = root.querySelector<HTMLInputElement>('input')!;
    firstToggle.click();
    await harness.fixture.whenStable();
    expect(root.querySelector('.browser-list')).toBeNull();
    expect(root.querySelector('.add-browser')).toBeNull();
    expect(preferences()!.browsers).toHaveLength(0);
    firstToggle.click();
    await harness.fixture.whenStable();
    expect(root.querySelectorAll('.browser-list li')).toHaveLength(1);
  });

  it('restores the previous toggle state if automatic setup or saving fails', async () => {
    loggedIn.set(true);
    save.mockResolvedValue(false);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/competition/league/settings', CompetitionSettingsPageComponent);
    await harness.fixture.whenStable();
    const toggle=harness.routeNativeElement!.querySelector<HTMLInputElement>('input')!;
    toggle.click();
    await harness.fixture.whenStable();
    expect(toggle.checked).toBe(false);
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
