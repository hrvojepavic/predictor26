self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const payload = event.data
    ? event.data.json()
    : {
        title: 'Prediction reminder',
        body: 'A prediction round is closing soon.',
        data: {
          url: '/'
        }
      };

  const title = payload.title || 'Prediction reminder';
  const options = {
    body: payload.body,
    icon: payload.icon || '/icons/predictor26-icon.svg',
    badge: payload.badge || '/icons/predictor26-icon.svg',
    tag: payload.tag,
    renotify: payload.renotify === true,
    data: payload.data || {
      url: '/'
    }
  };

  event.waitUntil((async () => {
    // Never display a push for an account other than the last login on this browser.
    // Missing recipient data fails closed, including legacy pushes queued before upgrade.
    const cache = await caches.open('predictor26-notification-recipient');
    const saved = await cache.match('/notification-recipient');
    const recipient = saved ? await saved.json() : null;
    if (!recipient || recipient.userId !== payload.data?.userId) return;
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client && client.url.startsWith(self.location.origin)) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
