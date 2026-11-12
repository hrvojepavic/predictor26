import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { AppStateService } from '@core/state/app-state.service';
import { NotificationsApiProvider } from './providers/notifications-api.provider';
import { NotificationBrowserAccountService } from './notification-browser-account.service';

describe('Notification browser account', () => {
  const token = signal<string | null>('A');
  const currentUser = signal<{id:number} | null>({id:1});
  const saveSubscription = vi.fn();
  const put = vi.fn();
  const subscription = { endpoint: 'https://push.test/shared' };
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  beforeEach(() => {
    token.set('A'); currentUser.set({id:1});
    localStorage.setItem('predictor26.session', JSON.stringify({token:'A'}));
    put.mockReset(); put.mockResolvedValue(undefined);
    saveSubscription.mockReset(); saveSubscription.mockReturnValue(of({subscribed:true}));
    vi.stubGlobal('caches', {open: async () => ({put})});
    Object.defineProperty(navigator, 'serviceWorker', {configurable:true, value:{
      getRegistration: async () => ({update:async () => {},pushManager:{getSubscription:async () => subscription}})
    }});
    TestBed.configureTestingModule({providers:[
      {provide:AppStateService,useValue:{token,currentUser}},
      {provide:NotificationsApiProvider,useValue:{saveSubscription}}
    ]});
  });

  afterEach(() => {
    localStorage.removeItem('predictor26.session');
    vi.unstubAllGlobals();
    if (originalServiceWorker) Object.defineProperty(navigator,'serviceWorker',originalServiceWorker);
    else Reflect.deleteProperty(navigator,'serviceWorker');
  });

  it('selects a newly logged-in account without requesting permission or changing competition choices', async () => {
    const service = TestBed.inject(NotificationBrowserAccountService);
    await service.synchronize(1,'A');
    token.set('B'); currentUser.set({id:2});
    localStorage.setItem('predictor26.session',JSON.stringify({token:'B'}));
    await service.synchronize(2,'B');
    expect(saveSubscription).toHaveBeenCalledTimes(2);
    expect(saveSubscription).toHaveBeenLastCalledWith(subscription);
    expect(await put.mock.calls[1][1].json()).toEqual({userId:2});
    token.set(null); currentUser.set(null); localStorage.removeItem('predictor26.session');
    await service.synchronize(2,'B');
    expect(put).toHaveBeenCalledTimes(2);
    expect(saveSubscription).toHaveBeenCalledTimes(2);
  });

  it('does not let an older tab reclaim the browser from the latest login', async () => {
    localStorage.setItem('predictor26.session',JSON.stringify({token:'B'}));
    await TestBed.inject(NotificationBrowserAccountService).synchronize(1,'A');
    expect(put).not.toHaveBeenCalled();
    expect(saveSubscription).not.toHaveBeenCalled();
  });

  it('sets the browser-side recipient even if server synchronization fails, and can retry', async () => {
    saveSubscription.mockImplementationOnce(() => { throw new Error('Offline'); });
    const service = TestBed.inject(NotificationBrowserAccountService);
    await expect(service.synchronize(1,'A')).rejects.toThrow('Offline');
    expect(await put.mock.calls[0][1].json()).toEqual({userId:1});
    await service.synchronize(1,'A');
    expect(saveSubscription).toHaveBeenCalledTimes(2);
  });

  it('does not synchronize on focus or reconnect after a successful login sync', async () => {
    const service = TestBed.inject(NotificationBrowserAccountService);
    await service.synchronize(1, 'A');
    const synchronize = vi.spyOn(service, 'synchronize');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    expect(synchronize).not.toHaveBeenCalled();
    expect(saveSubscription).toHaveBeenCalledTimes(1);
  });

  it.each(['focus', 'online'])('retries failed synchronization on %s only until it succeeds', async event => {
    saveSubscription.mockImplementationOnce(() => { throw new Error('Offline'); });
    const service = TestBed.inject(NotificationBrowserAccountService);
    await expect(service.synchronize(1, 'A')).rejects.toThrow('Offline');
    const synchronize = vi.spyOn(service, 'synchronize');
    window.dispatchEvent(new Event(event));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    expect(synchronize).toHaveBeenCalledTimes(1);
    await synchronize.mock.results[0].value;
    window.dispatchEvent(new Event(event));
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(saveSubscription).toHaveBeenCalledTimes(2);
  });

  it('does not enqueue focus retries while the initial synchronization is pending', async () => {
    const response = new Subject<{ subscribed: boolean }>();
    saveSubscription.mockReturnValueOnce(response);
    const service = TestBed.inject(NotificationBrowserAccountService);
    const pending = service.synchronize(1, 'A');
    await vi.waitFor(() => expect(saveSubscription).toHaveBeenCalledTimes(1));
    const synchronize = vi.spyOn(service, 'synchronize');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    expect(synchronize).not.toHaveBeenCalled();
    response.next({ subscribed: true });
    response.complete();
    await pending;
  });

  it('does not retry a failed sync after another tab changes accounts', async () => {
    saveSubscription.mockImplementationOnce(() => { throw new Error('Offline'); });
    const service = TestBed.inject(NotificationBrowserAccountService);
    await expect(service.synchronize(1, 'A')).rejects.toThrow('Offline');
    localStorage.setItem('predictor26.session', JSON.stringify({ token: 'B' }));
    const synchronize = vi.spyOn(service, 'synchronize');
    window.dispatchEvent(new Event('focus'));
    expect(synchronize).not.toHaveBeenCalled();
  });
});
