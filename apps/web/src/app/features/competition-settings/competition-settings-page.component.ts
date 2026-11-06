import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { AppStateService } from '@core/state/app-state.service';
import { CompetitionNotificationSettingsService } from '@services/competition-notification-settings.service';
import { NotificationRemindersService } from '@services/notification-reminders.service';

@Component({
  selector: 'app-competition-settings-page',
  imports: [ReactiveFormsModule],
  templateUrl: './competition-settings-page.component.html',
  styleUrl: './competition-settings-page.component.scss'
})
export class CompetitionSettingsPageComponent {
  protected readonly settings = inject(CompetitionNotificationSettingsService);
  private readonly browser = inject(NotificationRemindersService);
  protected readonly competition = inject(AppStateService).activeCompetition;
  private readonly browserChecked = signal(false);
  protected readonly competitionClosed = computed(() => this.settings.settings()?.competitionClosed === true || this.competition()?.isFinished === true);
  protected readonly savingTiming = signal<'reminder1h' | 'reminder9h' | 'roundOpened' | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({ reminder1h: false, reminder9h: false, roundOpened: false });
  protected readonly notificationsEnabled = computed(() => {
    const preferences = this.settings.settings()?.preferences;
    return !this.competitionClosed() && !!preferences?.enabled && (preferences.reminder1h || preferences.reminder9h || preferences.roundOpened);
  });
  protected readonly browsers = computed(() => (this.settings.settings()?.browsers ?? []).map(browser => ({
    ...browser, current: browser.fingerprint === this.browser.fingerprint()
  })));
  protected readonly canRemove = computed(() => this.browsers().length > 1);
  protected readonly canAdd = computed(() => {
    return this.browserChecked() && this.notificationsEnabled() && !this.browsers().some(browser => browser.current);
  });

  constructor() {
    effect(() => {
      const id = this.competition()?.id;
      if (id) untracked(() => { void this.settings.load(id); });
    });
    effect(() => {
      this.settings.settings();
      untracked(() => this.restoreForm());
    });
    void this.browser.refreshBrowserState().finally(() => this.browserChecked.set(true));
  }

  protected async toggle(timing: 'reminder1h' | 'reminder9h' | 'roundOpened'): Promise<void> {
    const id = this.competition()?.id;
    if (!id || this.settings.saving() || this.competitionClosed()) { this.restoreForm(); return; }
    const value = this.form.getRawValue();
    this.savingTiming.set(timing);
    try {
      await this.settings.save(id, { ...value, enabled: value.reminder1h || value.reminder9h || value.roundOpened }, value[timing]);
    } finally {
      this.savingTiming.set(null);
      this.restoreForm();
    }
  }

  protected async addBrowser(): Promise<void> {
    const id = this.competition()?.id;
    if (id && !this.competitionClosed()) await this.settings.addBrowser(id);
  }

  protected async removeBrowser(browserId: number): Promise<void> {
    const id = this.competition()?.id;
    if (id && this.canRemove()) await this.settings.removeBrowser(id, browserId);
  }

  protected reload(): void {
    const id = this.competition()?.id;
    if (id) void this.settings.load(id);
  }

  private restoreForm(): void {
    const preferences = this.settings.settings()?.preferences;
    const enabled = !this.competitionClosed() && !!preferences?.enabled;
    this.form.reset({
      reminder1h: enabled && !!preferences?.reminder1h,
      reminder9h: enabled && !!preferences?.reminder9h,
      roundOpened: enabled && !!preferences?.roundOpened
    }, { emitEvent: false });
  }
}
