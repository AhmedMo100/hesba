import type { Metadata } from "next";

/**
 * What a shared Hesba link shows (WhatsApp, Facebook, Messenger, Telegram, X, …): the name, one
 * plain sentence, and the preview image drawn from Hesba's own logo (`public/og-image.png`,
 * 1200×630, made by `scripts/make-og-image.mjs`). Nothing about any shop or user is ever in here.
 */
export const SITE_NAME = "حِسبة";
export const SITE_TITLE = "حِسبة — إدارة محلك ببساطة";
export const SITE_DESCRIPTION =
  "اعرف فلوسك وبضاعتك وديونك ومكسبك من مكان واحد.";

export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "حِسبة — إدارة محلك ببساطة",
  type: "image/png",
} as const;

/**
 * The public origin, so the preview image is an absolute URL (crawlers need one). The same
 * variables the server's origin check uses (`src/server/config/env.ts`); read directly here so
 * building the page never depends on the server's secrets.
 */
export function siteOrigin(
  env: Record<string, string | undefined> = process.env,
): URL {
  const raw =
    env["HESBA_APP_ORIGIN"] ||
    (env["VERCEL_PROJECT_PRODUCTION_URL"]
      ? `https://${env["VERCEL_PROJECT_PRODUCTION_URL"]}`
      : "") ||
    (env["VERCEL_URL"] ? `https://${env["VERCEL_URL"]}` : "") ||
    "http://localhost:3000";
  try {
    return new URL(raw);
  } catch {
    return new URL("http://localhost:3000");
  }
}

export function siteMetadata(origin: URL = siteOrigin()): Metadata {
  return {
    metadataBase: origin,
    applicationName: SITE_NAME,
    title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    openGraph: {
      type: "website",
      locale: "ar_EG",
      siteName: SITE_NAME,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      url: "/",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [{ url: OG_IMAGE.url, alt: OG_IMAGE.alt }],
    },
    // QA-49: installable PWA. `src/app/manifest.ts` adds the manifest link itself.
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
    },
    appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
    formatDetection: { telephone: false },
  };
}
