import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // The app's API is never cached by the service worker. Its default rule kept private
    // shop answers for 24 h keyed by URL only — the next shop signed in on the device could be
    // served them offline, and a slow network returned stale money/stock. The screens' offline
    // copies live in IndexedDB per shop instead (client/offline/read-cache), cleared on
    // sign-out.
    {
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin && pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

// Remove what the old rule stored.
self.addEventListener(
  "activate",
  (event: { waitUntil(p: Promise<unknown>): void }) => {
    event.waitUntil(caches.delete("apis"));
  },
);

serwist.addEventListeners();
