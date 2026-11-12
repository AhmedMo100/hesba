/**
 * Warms a `next dev` server before the e2e workers start (QA-54). In development Next
 * compiles each route on its first request and then reloads the open pages; with several
 * workers that reload hit other tests mid-flight. Requesting every page and API route once
 * here (unauthenticated: 401s still compile the route) makes runs independent of a cold
 * server. Nothing is written: only GET requests, and no session.
 */
import fs from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";

function apiRoutes(dir: string, base = "/api"): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const seg = entry.name.startsWith("[")
        ? "00000000-0000-4000-8000-000000000000"
        : entry.name;
      out.push(...apiRoutes(full, `${base}/${seg}`));
    } else if (entry.name === "route.ts") {
      out.push(base);
    }
  }
  return out;
}

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    config.projects[0]?.use.baseURL ??
    process.env["HESBA_APP_ORIGIN"] ??
    "http://localhost:3000";
  const pages = [
    "/login",
    "/signup",
    "/forgot-password",
    "/app",
    "/manifest.webmanifest",
  ];
  const routes = apiRoutes(path.resolve(process.cwd(), "src/app/api")).filter(
    (r) => !r.startsWith("/api/cron"),
  );
  // One at a time: parallel first compiles slow each other down.
  for (const url of [...pages, ...routes]) {
    try {
      await fetch(new URL(url, baseURL), {
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      // A route that cannot answer a bare GET still got compiled; the tests report real errors.
    }
  }
}
