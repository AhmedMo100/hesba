import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { securityHeaders } from "./src/server/config/security-headers";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  poweredByHeader: false,
  // Security headers on every response: pages, API (successes and errors), static files (QA-26).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          production: process.env.NODE_ENV === "production",
          hstsIncludeSubdomains:
            process.env["HESBA_HSTS_INCLUDE_SUBDOMAINS"] === "1",
        }),
      },
      // A shop's money, stock, sales and debts are never kept by a browser or a proxy: every API
      // answer is read fresh (2026-11-26). The screens' own read cache (client/shared/api/
      // read-cache.ts) is dropped on every write; the service worker sends /api/* to the network.
      // The shared catalog sync sets its own short private cache and is left out here.
      {
        source: "/api/:path((?!sync/catalog).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default withSerwist(nextConfig);
