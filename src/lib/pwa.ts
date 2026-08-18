/**
 * Progressive Web App bootstrap for enough.
 *
 * Registers the production service worker (emitted by scripts/pwa-plugin.ts)
 * and keeps the installed app on the latest deploy. Intentionally does not
 * request notification permission or register for push.
 */

/** Vite base, always ending with `/` (e.g. `/` or `/enough/`). */
function appBase(): string {
  const raw = import.meta.env.BASE_URL || '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/**
 * Register the service worker in production builds only.
 * In dev, Vite serves modules without a built SW — registering would 404 and
 * pollute the console.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  const swUrl = `${appBase()}sw.js`;

  // Snapshot *before* we register: the very first install also fires
  // controllerchange once the SW claims, and we must not bounce that load.
  // Subsequent controller swaps (post-deploy) should soft-reload once so the
  // page leaves the stale in-memory bundle.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    try {
      if (sessionStorage.getItem('enough-sw-reloaded') === '1') return;
      sessionStorage.setItem('enough-sw-reloaded', '1');
    } catch {
      /* storage blocked */
    }
    refreshing = true;
    window.location.reload();
  });

  // Allow a future deploy to trigger another soft-reload in this tab.
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem('enough-sw-reloaded');
    } catch {
      /* ignore */
    }
  }, 10_000);

  const register = () => {
    navigator.serviceWorker
      .register(swUrl, { scope: appBase(), updateViaCache: 'none' })
      .then((registration) => {
        // Proactively check for updates on focus / visibility — GitHub Pages
        // has no push channel, so this is how deploys reach installed apps.
        const check = () => {
          registration.update().catch(() => undefined);
        };
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
        // First check shortly after load (covers a worker already waiting).
        setTimeout(check, 2_000);
      })
      .catch(() => {
        /* registration failed (private mode, HTTP, etc.) — app still works */
      });
  };

  // Defer until the page is idle so first paint / auth restore stay snappy.
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}
