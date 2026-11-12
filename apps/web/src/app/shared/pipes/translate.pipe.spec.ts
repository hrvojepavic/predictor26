import { Component, computed, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslatePipe } from './translate.pipe';
import { LocalizedDatePipe } from './localized-date.pipe';
import { Language } from '@core/i18n/language.config';
import { TranslationService } from '@services/translation.service';
import { testTranslationsProvider, initializeTestTranslations } from '../../../../testing/translations';

@Component({
  imports: [TranslatePipe, LocalizedDatePipe],
  template: `<p>{{ 'ui.saved_winner_pick_p0' | translate: { p0: 'Croatia' } }}</p>
    <span class="ts">{{ message() }}</span>
    <span class="round">{{ round }}</span>
    <time>{{ date | localizedDate: 'MMMM' }}</time>
    <span class="clock">{{ date | localizedDate: 'HH:mm' }}</span>`
})
class TranslationFixture {
  private readonly translations = inject(TranslationService);
  readonly message = computed(() => this.translations.translate('ui.saved_winner_pick_p0', { p0: 'Croatia' }));
  readonly round = 'Group stage - Round 2';

  readonly date = new Date(2026, 10, 12, 12);
}

describe('Localized display values', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [testTranslationsProvider] });
    await initializeTestTranslations();
  });

  it('updates translated labels and dates while leaving API labels unchanged', async () => {
    const fixture = TestBed.createComponent(TranslationFixture);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('p')?.textContent).toBe('Saved winner pick: Croatia.');
    expect(root.querySelector('.ts')?.textContent).toBe(root.querySelector('p')?.textContent);
    expect(root.querySelector('time')?.textContent).toBe('November');
    await TestBed.inject(TranslationService).setLanguage(Language.Croatian);
    await fixture.whenStable();
    expect(root.querySelector('p')?.textContent).toBe('Spremljen odabir pobjednika: Croatia.');
    expect(root.querySelector('.ts')?.textContent).toBe(root.querySelector('p')?.textContent);
    expect(root.querySelector('.round')?.textContent).toBe('Group stage - Round 2');
    expect(root.querySelector('time')?.textContent).toContain('studen');
    expect(root.querySelector('.clock')?.textContent).toBe('12:00');
    expect(fixture.componentInstance.round).toBe('Group stage - Round 2');
  });

  it('does not translate parameter values', () => {
    const service = TestBed.inject(TranslationService);
    expect(service.translate('ui.saved_winner_pick_p0', { p0: 'ui.saved' })).toBe('Saved winner pick: ui.saved.');
  });
});
