import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Language } from '@core/i18n/language.config';
import type { LocalizedString } from '@models/content-localization.models';
import { LocalizedTextInputComponent } from './localized-text-input.component';
import { initializeTestTranslations, testTranslationsProvider } from '../../../../../testing/translations';

@Component({
  imports: [LocalizedTextInputComponent, ReactiveFormsModule],
  template: `<app-localized-text-input [languages]="languages" label="Rule" [formControl]="text" />`
})
class EditorFixture {
  readonly languages = [{ code: Language.English, name: 'English', enabled: true }, { code: Language.Croatian, name: 'Hrvatski', enabled: true }];
  readonly text = new FormControl<readonly LocalizedString[]>([{ languageCode: Language.English, value: 'Original' }], { nonNullable: true });
}

describe('Localized text editor', () => {
  it('keeps each language draft when switching tabs and propagates disabled state', async () => {
    TestBed.configureTestingModule({ providers: [testTranslationsProvider] });
    await initializeTestTranslations();
    const fixture = TestBed.createComponent(EditorFixture);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('textarea')!;
    const tabs = root.querySelectorAll('button');
    input.value = 'Edited'; input.dispatchEvent(new Event('input'));
    tabs[1].click(); await fixture.whenStable();
    expect(input.value).toBe('');
    input.value = 'Pravilo'; input.dispatchEvent(new Event('input'));
    tabs[0].click(); await fixture.whenStable();
    expect(input.value).toBe('Edited');
    expect(fixture.componentInstance.text.value).toEqual([
      { languageCode: Language.English, value: 'Edited' }, { languageCode: Language.Croatian, value: 'Pravilo' }
    ]);
    fixture.componentInstance.text.disable(); await fixture.whenStable();
    expect(input.disabled).toBe(true);
    expect(tabs[0].disabled).toBe(true);
  });
});
