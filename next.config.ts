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
    ];
  },
};

export default withSerwist(nextConfig);
