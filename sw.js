// Brandlab service worker — ONLY for the opt-in upload reminders (Settings →
// Pengingat, js/reminders.js registers it when the owner taps "Nyalakan").
// Deliberately no `fetch` handler and no caching: the app loads exactly as it
// does without this file, and can never be served a stale version from here.

self.addEventListener("install", () => self.skipWaiting());
// Take over pages already open, so a notification tap can navigate them.
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Only ever open a page of this same site, whatever the payload says.
function sameOriginUrl(raw) {
  try {
    const u = new URL(raw || "/", self.location.origin);
    return u.origin === self.location.origin ? u.href : self.location.origin + "/";
  } catch (e) {
    return self.location.origin + "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Brandlab";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/assets/wepeka-apple-icon.png",
      tag: typeof data.tag === "string" && data.tag ? data.tag : "brandlab-reminder",
      data: { url: sameOriginUrl(data.url) },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) {
      try {
        const focused = await open.focus();
        if (focused && "navigate" in focused) await focused.navigate(url);
        return;
      } catch (e) {
        // Not controlled by this worker (navigate refuses) — open a new window below.
      }
    }
    await self.clients.openWindow(url);
  })());
});
