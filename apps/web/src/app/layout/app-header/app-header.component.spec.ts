import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AppStateService } from '@core/state/app-state.service';
import { FinalResultsService } from '@services/final-results.service';
import { CompetitionsService } from '@services/competitions.service';
import { MatchesService } from '@services/matches.service';
import { MatchWithPrediction } from '@models/match.models';
import { AuthUser } from '@models/auth-user.model';
import { Competition } from '@models/competition.models';
import { AppHeaderComponent } from './app-header.component';

describe('Header navigation drawer', () => {
  const user = signal<AuthUser | null>(null);
  const competition = signal<Competition | null>(null);
  const loggedIn = signal(false);
  const available = signal(false);
  const openFinalResults = vi.fn();
  const clearCompetitions = vi.fn();
  const clearSession = vi.fn(() => { user.set(null); loggedIn.set(false); competition.set(null); });
  const matches = signal<MatchWithPrediction[]>([]);
  const ensureMatches = vi.fn(() => null);

  beforeEach(() => {
    user.set(null);
    competition.set(null);
    loggedIn.set(false);
    available.set(false);
    openFinalResults.mockClear();
    clearCompetitions.mockClear();
    clearSession.mockClear();
    ensureMatches.mockClear();
    matches.set([]);
    TestBed.configureTestingModule({
      imports: [AppHeaderComponent],
      providers: [
        provideRouter([]),
        { provide: AppStateService, useValue: { currentUser: user, activeCompetition: competition, isLoggedIn: loggedIn, clearSession } },
        { provide: CompetitionsService, useValue: { clearCompetitions } },
        { provide: MatchesService, useValue: { matches, ensureMatches } },
        { provide: FinalResultsService, useValue: { available, openFinalResults } }
      ]
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(AppHeaderComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const toggle = root.querySelector<HTMLButtonElement>('.menu-toggle');
    return { fixture, root, toggle };
  }

  it('keeps the backdrop blocking, traps focus, and closes with Escape', async () => {
    const { fixture, root, toggle } = await render();
    toggle!.click();
    await fixture.whenStable();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(root.querySelector('.brand')!.hasAttribute('inert')).toBe(true);
    (root.querySelector('.modal-backdrop') as HTMLElement).click();
    await fixture.whenStable();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    const links = root.querySelectorAll<HTMLAnchorElement>('.menu-link');
    expect(Array.from(links).map(link => link.textContent?.trim())).toEqual(['Login›', 'Register›']);
    links[links.length - 1].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(document.activeElement).toBe(toggle);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }));
    expect(document.activeElement).toBe(links[links.length - 1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('keeps the same hamburger visible and usable while the session loads', async () => {
    loggedIn.set(true);
    const { fixture, root, toggle } = await render();
    expect(toggle).not.toBeNull();
    toggle!.click();
    await fixture.whenStable();
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Loading your account');
    expect(root.querySelector('a[href="/login"]')).toBeNull();
    signIn();
    await fixture.whenStable();
    expect(root.querySelector('.menu-toggle')).toBe(toggle);
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(root.querySelector('#menu-user-title')?.textContent).toContain('Player');
  });

  function signIn() {
    loggedIn.set(true);
    user.set({ id: 1, username: 'Player', name: '', lastname: '', tiebreakerName: null, role: 'admin', isVerified: true });
    competition.set({ id: 1, name: 'League', slug: 'league', logoUrl: null, isFinished: false, playoffsEnabled: false, buyInEur: 0, isJoined: true, tiebreakerName: null });
    available.set(true);
  }

  it('keeps competition-only actions out of league selection', async () => {
    signIn();
    const { fixture, root, toggle } = await render();
    toggle!.click();
    await fixture.whenStable();
    const nav = root.querySelector('nav')!;
    expect(nav.textContent).toContain('Player');
    expect(nav.textContent).toContain('Admin');
    expect(nav.textContent).not.toContain('Stats');
    expect(nav.textContent).not.toContain('Final rankings');
    expect(nav.textContent).not.toContain('My predictions');
  });

  it('preserves competition destinations and closes when a link is selected', async () => {
    signIn();
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/competition/league');
    const { fixture, root, toggle } = await render();
    toggle!.click();
    await fixture.whenStable();
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.menu-link[href]'));
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/competition/league/predictions', '/competition/league/my-predictions', '/competition/league/match-day', '/competition/league/stats', '/competition/league/rules', '/', '/admin']);
    links.find(link => link.getAttribute('href')?.endsWith('/stats'))!.click();
    await fixture.whenStable();
    expect(router.url).toBe('/competition/league/stats');
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes navigation before opening final rankings', async () => {
    signIn();
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/competition/league');
    const { fixture, root, toggle } = await render();
    toggle!.click();
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('.final-rankings-link')!.click();
    await fixture.whenStable();
    expect(openFinalResults).toHaveBeenCalledOnce();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows only missing predictions for the next open round and reacts to saves', async () => {
    signIn();
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/competition/league');
    const match = (id: number, round: string, deadline: string, extra: Partial<MatchWithPrediction> = {}) => ({
      id, predictionRound: round, predictionDeadlineAt: deadline, prediction: null, isPostponed: false, ...extra
    } as MatchWithPrediction);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const later = new Date(Date.now() + 172_800_000).toISOString();
    matches.set([
      match(1, 'Old', '2020-01-01T00:00:00Z'),
      match(2, 'Next', future),
      match(3, 'Next', future, { isPostponed: true }),
      match(4, 'Next', future, { prediction: { home: 1, away: 0, odds: null } }),
      match(5, 'Later', later)
    ]);
    const { fixture, root, toggle } = await render();
    toggle!.click();
    await fixture.whenStable();
    expect(ensureMatches).toHaveBeenCalled();
    expect(root.querySelector('app-prediction-count-badge span')?.textContent?.trim()).toBe('1');
    matches.update(items => items.map(item => item.id === 2 ? { ...item, prediction: { home: 0, away: 0, odds: null } } : item));
    await fixture.whenStable();
    expect(root.querySelector('app-prediction-count-badge span')).toBeNull();
  });

  it('logs out from the menu and clears the session and competition data', async () => {
    signIn();
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    const { fixture, root, toggle } = await render();
    toggle!.click();
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('.logout-link')!.click();
    await fixture.whenStable();
    expect(clearCompetitions).toHaveBeenCalledOnce();
    expect(clearSession).toHaveBeenCalledOnce();
    expect(router.url).toBe('/login');
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
  });
});
