import type { MetadataRoute } from "next";

/**
 * Web app manifest (QA-49), served at `/manifest.webmanifest`. With the service worker
 * (`/sw.js`, registered by the app shell in production) it makes Hesba installable on a phone.
 * Colors match the light theme (`layout.tsx` `themeColor`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "حسبة",
    short_name: "حسبة",
    description: "نظام إدارة الحسابات والمخزون للمحلات والسوبر ماركت",
    lang: "ar",
    dir: "rtl",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#EFE8D6",
    theme_color: "#EFE8D6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
