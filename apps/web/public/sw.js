self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }

  const title = typeof payload.title === 'string' ? payload.title : 'EV charging update';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const options = {
    body,
    data: payload.data && typeof payload.data === 'object' ? payload.data : {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/settings?tab=notifications'));
});
