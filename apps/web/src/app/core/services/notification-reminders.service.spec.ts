import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { AppStateService } from '@core/state/app-state.service';
import { NotificationsApiProvider } from './providers/notifications-api.provider';
import { NotificationBrowserAccountService } from './notification-browser-account.service';
import { NotificationRemindersService } from './notification-reminders.service';
import { NotificationConfigResponse } from '@models/notification.models';

describe('Browser notification setup', () => {
  const token = signal('account-one');
  const addBrowser = vi.fn();
  const getConfig = vi.fn();
  const saveSubscription = vi.fn();
  const requestPermission = vi.fn();
  const subscribe = vi.fn();
  const existing = vi.fn();
  const registration = { pushManager: { getSubscription: existing, subscribe } };
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  beforeEach(() => {
    token.set('account-one');
    localStorage.setItem('predictor26.session', JSON.stringify({token:'account-one'}));
    addBrowser.mockReset();
    addBrowser.mockReturnValue(of({preferences:{enabled:false,reminder1h:false,reminder9h:false, roundOpened: false},browsers:[],competitionEnabled:true,competitionClosed:false,eligible:true}));
    getConfig.mockReset(); saveSubscription.mockReset(); requestPermission.mockReset(); subscribe.mockReset(); existing.mockReset();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    vi.stubGlobal('PushManager', function () {});
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      register: vi.fn(async () => registration), ready: Promise.resolve(registration)
    } });
    requestPermission.mockResolvedValue('granted');
    getConfig.mockReturnValue(of({ vapidPublicKey: 'AQID', remindersEnabled: false }));
    existing.mockResolvedValue(null);
    subscribe.mockResolvedValue({ endpoint: 'https://push.test/browser', toJSON: () => ({ endpoint: 'test' }) });
    saveSubscription.mockReturnValue(of({ subscribed: true }));
    TestBed.configureTestingModule({ providers: [
      { provide: AppStateService, useValue: { token, currentUser: () => ({id:1}), activeCompetition: () => ({ id: 7 }) } },
      { provide: NotificationBrowserAccountService, useValue: { withCurrentAccount: async (_id: number, _token: string, action: () => Promise<unknown>) => action() } },
      { provide: NotificationsApiProvider, useValue: { getConfig, saveSubscription, addBrowser } }
    ] });
  });

  afterEach(() => {
    localStorage.removeItem('predictor26.session');
    vi.unstubAllGlobals();
    if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    else Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('requests permission from the click before fetching configuration and does not require the admin switch', async () => {
    const service = TestBed.inject(NotificationRemindersService);
    const result = service.enableReminders(7);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(getConfig).not.toHaveBeenCalled();
    expect((await result).status).toBe('subscribed');
    expect(getConfig).toHaveBeenCalledWith(7);
    expect(addBrowser).toHaveBeenCalledWith(7, expect.anything());
  });

  it('uses previously granted browser permission without prompting again', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission });
    const result = await TestBed.inject(NotificationRemindersService).enableReminders(7);
    expect(result.status).toBe('subscribed');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(addBrowser).toHaveBeenCalledWith(7, expect.anything());
  });

  it('does not register subscriptions after permission is denied', async () => {
    requestPermission.mockResolvedValue('denied');
    const result = await TestBed.inject(NotificationRemindersService).enableReminders(7);
    expect(result.status).toBe('blocked');
    expect(saveSubscription).not.toHaveBeenCalled();
    expect(addBrowser).not.toHaveBeenCalled();
  });

  it('treats closing the prompt as undecided and allows a later explicit retry', async () => {
    requestPermission.mockResolvedValue('default');
    const service = TestBed.inject(NotificationRemindersService);
    expect(await service.enableReminders(7)).toMatchObject({ status: 'dismissed', permission: 'default' });
    expect(await service.enableReminders(7)).toMatchObject({ status: 'dismissed', permission: 'default' });
    expect(requestPermission).toHaveBeenCalledTimes(2);
    expect(getConfig).not.toHaveBeenCalled();
    expect(addBrowser).not.toHaveBeenCalled();
    expect(service.browserState()).toContain('If no prompt appears');
    requestPermission.mockResolvedValue('granted');
    expect((await service.enableReminders(7)).status).toBe('subscribed');
  });

  it('recognizes an existing browser block without repeatedly requesting permission', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission });
    const service = TestBed.inject(NotificationRemindersService);
    expect((await service.enableReminders(7)).status).toBe('blocked');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
    expect(addBrowser).not.toHaveBeenCalled();
    expect(service.browserState()).toContain('blocked list');
    // A later click reads the browser's current permission, not a cached block.
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    expect((await service.enableReminders(7)).status).toBe('subscribed');
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it('does not assign an in-flight subscription to a different signed-in account', async () => {
    const config = new Subject<NotificationConfigResponse>();
    getConfig.mockReturnValue(config);
    const result = TestBed.inject(NotificationRemindersService).enableReminders(7);
    await Promise.resolve();
    token.set('account-two');
    config.next({ vapidPublicKey: 'AQID', remindersEnabled: true });
    config.complete();
    expect((await result).status).toBe('failed');
    expect(saveSubscription).not.toHaveBeenCalled();
    expect(addBrowser).not.toHaveBeenCalled();
  });

  it('reuses an existing subscription with the same server key', async () => {
    const subscription = { endpoint:'https://push.test/browser', options: { applicationServerKey: new Uint8Array([1,2,3]).buffer }, unsubscribe: vi.fn() };
    existing.mockResolvedValue(subscription);
    expect((await TestBed.inject(NotificationRemindersService).enableCurrentBrowserForAdminTest()).status).toBe('subscribed');
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(saveSubscription).toHaveBeenCalledWith(subscription);
  });
});
