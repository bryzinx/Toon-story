// Service worker mínimo: só exibe notificações e trata o clique nelas (não guarda nada em cache).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./toonstory.html", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (cs) => {
    for (const c of cs) if (c.url.split("#")[0] === url.split("#")[0]) { await c.focus(); try { await c.navigate(url); } catch {} return; }
    return self.clients.openWindow(url);
  }));
});
