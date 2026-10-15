// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference lib="webworker" />
/**
 * OpenShaper service worker — offline support for the `/app` editor and the `/fin`
 * fin designer only.
 *
 * Navigation model (the reason this is a hand-written `injectManifest` worker
 * rather than a generated one):
 *
 *  1. `/app`, `/fin` and their variants are served from the precache, so the editor
 *     and the fin designer open with no network at all.
 *  2. Every other navigation is `NetworkOnly` — online it behaves exactly as if
 *     no service worker existed: real HTML, and real 404s for unknown paths
 *     (the site has no SPA catch-all by design). Only a network *failure* falls
 *     through to the catch handler, which serves the branded offline page.
 *
 * workbox's generated `navigateFallback` cannot express this: it uses
 * `createHandlerBoundToURL`, which is cache-only, so pointing it at the offline
 * page would serve that page to marketing routes *even when online*.
 *
 * Nothing marketing-related is ever cached, so stale marketing HTML is
 * structurally impossible.
 */
import { clientsClaim } from 'workbox-core';
import { createHandlerBoundToURL, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

// tsconfig has both DOM and WebWorker libs, so `self` is typed as Window here.
// Alias rather than `declare const self`, which would be a redeclaration.
const sw = self as unknown as ServiceWorkerGlobalScope;

const OFFLINE_URL = '/offline.html';
/** Each offline island: its precached shell, and the paths it answers (never /apple). */
const SHELLS: readonly { url: string; path: RegExp }[] = [
  { url: '/app', path: /^\/app(?:\/|$)/ },
  { url: '/fin', path: /^\/fin(?:\/|$)/ },
];

// NOTE: this must stay spelled `self.__WB_MANIFEST` verbatim — workbox injects
// the precache list by string-replacing that exact token in the built worker, so
// routing it through the `sw` alias above makes the build fail.
precacheAndRoute((self as unknown as ServiceWorkerGlobalScope).__WB_MANIFEST);

// Editor and fin designer navigations → their precached shells. A bare `/app` or
// `/fin` is already served by the precache route registered above; this covers the
// trailing-slash and query-string variants.
for (const shell of SHELLS) {
  registerRoute(
    ({ request, url }) =>
      request.mode === 'navigate' &&
      url.origin === sw.location.origin &&
      shell.path.test(url.pathname),
    createHandlerBoundToURL(shell.url),
  );
}

// Everything else: straight to the network, never cached.
registerRoute(({ request }) => request.mode === 'navigate', new NetworkOnly());

setCatchHandler(async ({ request }) => {
  if (request.mode === 'navigate') {
    return (await matchPrecache(OFFLINE_URL)) ?? Response.error();
  }
  return Response.error();
});

// `registerType: 'prompt'` means we never skipWaiting on install — an update
// only activates when the user accepts it, so an in-progress edit is never
// interrupted. virtual:pwa-register's updateServiceWorker() posts this message.
sw.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
  }
});

// Safe with skipWaiting disabled: an updated worker only activates after the
// user accepts, so claiming can never hand an old page new assets. On first
// install it makes /app and /fin offline-capable without needing a second visit.
clientsClaim();
