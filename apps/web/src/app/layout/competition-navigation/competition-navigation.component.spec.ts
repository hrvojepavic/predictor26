import { Component, signal } from '@angular/core';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { AppStateService } from '@core/state/app-state.service';
import { MatchesService } from '@services/matches.service';
import { PredictionSummaryService } from '@services/prediction-summary.service';
import { initializeTestTranslations, testTranslationsProvider } from '../../../../testing/translations';
import { CompetitionNavigationComponent } from './competition-navigation.component';

@Component({ template: '' })
class PageFixture {}

describe('Floating competition navigation', () => {
  it('tracks the current route, preserves the prediction badge, and hides outside competition pages', async () => {
    const remainingCount = signal(3);
    const activeCompetition = signal({ id: 1, slug: 'test-league' });
    const ensureMatches = vi.fn(() => of({ matches: [] }));
    TestBed.configureTestingModule({ providers: [
      provideRouter([{ path: '**', component: PageFixture }]), testTranslationsProvider,
      { provide: AppStateService, useValue: { activeCompetition, isLoggedIn: () => true } },
      { provide: PredictionSummaryService, useValue: { remainingCount } },
      { provide: MatchesService, useValue: { ensureMatches } }
    ] });
    await initializeTestTranslations();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/competition/test-league');
    const fixture = TestBed.createComponent(CompetitionNavigationComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('a')).toHaveLength(4);
    expect(root.querySelector('[aria-current=page]')?.textContent).toContain('Rankings');
    expect(root.querySelector('app-prediction-count-badge')?.textContent).toContain('3');
    expect(ensureMatches).toHaveBeenCalledOnce();
    const indicator = root.querySelector('.selection-indicator');
    await router.navigateByUrl('/competition/test-league/predictions?round=2');
    await fixture.whenStable();
    expect(root.querySelectorAll('[aria-current=page]')).toHaveLength(1);
    expect(root.querySelector('.selection-indicator')).toBe(indicator);
    expect((indicator as HTMLElement).style.transform).toContain('1 *');
    expect(root.querySelector('[aria-current=page]')?.getAttribute('href')).toBe('/competition/test-league/predictions');
    remainingCount.set(0);
    await fixture.whenStable();
    expect(root.querySelector('app-prediction-count-badge span')).toBeNull();
    expect(ensureMatches).toHaveBeenCalledOnce();
    await router.navigateByUrl('/admin');
    await fixture.whenStable();
    expect(root.querySelector('nav')).toBeNull();
    expect(root.querySelector('.navigation-space')).toBeNull();
    activeCompetition.set({ id: 2, slug: 'another-league' });
    await router.navigateByUrl('/competition/another-league/match-day');
    await fixture.whenStable();
    expect(root.querySelector('[aria-current=page]')?.getAttribute('href')).toBe('/competition/another-league/match-day');
    expect(ensureMatches).toHaveBeenCalledTimes(2);
  });

  it('reserves navigation space with a skeleton before initial routing completes', async () => {
    TestBed.configureTestingModule({ providers: [
      provideRouter([{ path: '**', component: PageFixture }]), testTranslationsProvider,
      { provide: AppStateService, useValue: {
        activeCompetition: signal({ id: 1, slug: 'test-league' }), isLoggedIn: () => true
      } },
      { provide: PredictionSummaryService, useValue: { remainingCount: signal(0) } },
      { provide: MatchesService, useValue: { ensureMatches: () => of({ matches: [] }) } }
    ] });
    await initializeTestTranslations();
    vi.spyOn(TestBed.inject(Location), 'path').mockReturnValue('/competition/test-league');
    const fixture = TestBed.createComponent(CompetitionNavigationComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const navigation = root.querySelector('nav');
    expect(navigation?.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelectorAll('.navigation-placeholder')).toHaveLength(4);
    expect(root.querySelector('a')).toBeNull();
    await TestBed.inject(Router).navigateByUrl('/competition/test-league');
    await fixture.whenStable();
    expect(root.querySelector('nav')).toBe(navigation);
    expect(navigation?.getAttribute('aria-busy')).toBe('false');
    expect(root.querySelectorAll('a')).toHaveLength(4);
    expect(root.querySelector('.navigation-placeholder')).toBeNull();
  });
});
