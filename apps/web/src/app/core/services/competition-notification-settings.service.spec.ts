import { HttpErrorResponse } from '@angular/common/http';
import { NotificationRemindersService } from './notification-reminders.service';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { AppStateService } from '@core/state/app-state.service';
import { NotificationPreferencesResponse } from '@models/notification.models';
import { NotificationsApiProvider } from './providers/notifications-api.provider';
import { CompetitionNotificationSettingsService } from './competition-notification-settings.service';

const response: NotificationPreferencesResponse = {
  browsers: [],
  preferences: { enabled: true, reminder9h: true, reminder1h: false }, competitionEnabled: true, eligible: true
};

describe('Competition notification settings state', () => {
  const enableReminders = vi.fn();
  const getPreferences = vi.fn();
  const savePreferences = vi.fn();
  beforeEach(() => {
    enableReminders.mockReset();
    getPreferences.mockReset(); savePreferences.mockReset();
    TestBed.configureTestingModule({ providers: [
      { provide: NotificationRemindersService, useValue: { enableReminders } },
      { provide: AppStateService, useValue: { token: signal('test') } },
      { provide: NotificationsApiProvider, useValue: { getPreferences, savePreferences } }
    ] });
  });

  it('ignores a stale response after switching competitions', async () => {
    const first = new Subject<NotificationPreferencesResponse>();
    getPreferences.mockReturnValueOnce(first).mockReturnValueOnce(of({ ...response, preferences: { enabled: false, reminder9h: false, reminder1h: false } }));
    const service = TestBed.inject(CompetitionNotificationSettingsService);
    const oldLoad = service.load(1);
    await service.load(2);
    first.next(response); first.complete(); await oldLoad;
    expect(service.settings()?.preferences.enabled).toBe(false);
  });

  it('pins saves to the requested competition and retains saved state on failure', async () => {
    getPreferences.mockReturnValue(of(response));
    savePreferences.mockReturnValue(throwError(() => new HttpErrorResponse({status:0})));
    const service = TestBed.inject(CompetitionNotificationSettingsService);
    await service.load(2);
    await service.save(2, { ...response.preferences, enabled: false });
    expect(savePreferences).toHaveBeenCalledWith(2, { ...response.preferences, enabled: false });
    expect(service.settings()).toEqual(response);
    expect(service.error()).toContain('not saved');
  });
  it('does not turn reminders on when permission is denied', async () => {
    const off = { ...response, preferences: { enabled:false, reminder1h:false, reminder9h:false } };
    getPreferences.mockReturnValue(of(off));
    enableReminders.mockResolvedValue({ status:'blocked', permission:'denied' });
    const service=TestBed.inject(CompetitionNotificationSettingsService);
    await service.load(2);
    expect(await service.save(2,response.preferences,true)).toBe(false);
    expect(savePreferences).not.toHaveBeenCalled();
    expect(service.settings()).toEqual(off);
    expect(service.error()).toContain('Allow notifications');
  });

  it('adds the current browser before automatically saving a selected reminder', async () => {
    getPreferences.mockReturnValue(of(response));
    enableReminders.mockResolvedValue({status:'subscribed',permission:'granted',settings:response});
    savePreferences.mockReturnValue(of(response));
    const service=TestBed.inject(CompetitionNotificationSettingsService);
    await service.load(2);
    expect(await service.save(2,response.preferences,true)).toBe(true);
    expect(enableReminders).toHaveBeenCalledWith(2);
    expect(savePreferences).toHaveBeenCalledWith(2,response.preferences);
  });

  it('keeps preferences off after dismissal and explains how to recover a missing prompt', async () => {
    const off = { ...response, preferences: { enabled: false, reminder1h: false, reminder9h: false } };
    getPreferences.mockReturnValue(of(off));
    enableReminders.mockResolvedValue({ status: 'dismissed', permission: 'default' });
    const service = TestBed.inject(CompetitionNotificationSettingsService);
    await service.load(2);
    expect(await service.save(2, response.preferences, true)).toBe(false);
    expect(savePreferences).not.toHaveBeenCalled();
    expect(service.settings()).toEqual(off);
    expect(service.error()).toContain('If no prompt appears');
    expect(service.error()).not.toContain('blocked list');
  });
});
