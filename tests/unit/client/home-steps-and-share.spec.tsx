/**
 * Owner's polish of 2026-11-26:
 * - Home: three small arrows only (دخلت بضاعة ↓ بيعت حاجة · بيعت حاجة ← شوف تقاريرك ·
 *   صرفت فلوس ↓ شوف تقاريرك), nothing between ١ and ٢; «بيعت حاجة» is a normal step and only
 *   «شوف تقاريرك» stands out; no bell beside «أهلاً بيك»; the alerts line sits right under
 *   «فلوس المحل» and opens «التنبيهات».
 * - The stocktake: three short steps, four plain reasons.
 * - A shared link: the name, one sentence, the 1200×630 preview, never user data.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeView } from "@/client/features/home/HomeView";
import {
  OG_IMAGE,
  SITE_DESCRIPTION,
  SITE_TITLE,
  siteMetadata,
  siteOrigin,
} from "@/app/site-metadata";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function home(mode: "simple" | "pos") {
  return renderToStaticMarkup(
    <HomeView onNavigate={() => {}} onLogout={() => {}} operatingMode={mode} />,
  );
}

describe("Home — the four steps and their arrows", () => {
  for (const mode of ["simple", "pos"] as const) {
    it(`${mode}: exactly three arrows, in the owner's places`, () => {
      const html = home(mode);
      const arrows = [
        ...html.matchAll(
          /data-testid="home-step-arrow" data-dir="(down|left)"/g,
        ),
      ].map((m) => m[1]);
      expect(arrows).toEqual(["down", "down", "left"]);
      // Their grid places: ١ ↓ ٣ (d1), ٢ ↓ ٤ (d2), ٣ ← ٤ (h3). Nothing between ١ and ٢.
      const areas = [
        ...html.matchAll(
          /style="grid-area:(\w+)"[^>]*data-testid="home-step-arrow"/g,
        ),
      ].map((m) => m[1]);
      expect(areas).toEqual(["d1", "d2", "h3"]);
      const css = read("src/client/features/home/HomeView.module.css");
      expect(css).toMatch(/"s1 \. s2"\s*"d1 \. d2"\s*"s3 h3 s4"/);
      // The old elbow (٢ → ٣) is gone for good.
      expect(html).not.toMatch(/stepTurn/);
      expect(css).not.toMatch(/stepTurn/);
    });
  }

  it("«بيعت حاجة» is a normal step; only «شوف تقاريرك» stands out", () => {
    const html = home("pos");
    const cls = (route: string) =>
      new RegExp(`class="([^"]*)"[^>]*data-testid="home-tile-${route}"`).exec(
        html,
      )?.[1] ?? "";
    expect(cls("sales")).toBe(cls("stock"));
    expect(cls("expenses")).toBe(cls("stock"));
    expect(cls("reports")).not.toBe(cls("stock"));
    expect(cls("reports")).toMatch(/stepReport/);
    expect(home("simple")).toMatch(/data-testid="home-tile-daily-sales"/);
  });

  it("no bell beside «أهلاً بيك»; the alerts line is right under «فلوس المحل»", () => {
    const html = home("simple");
    expect(html).not.toMatch(/home-alerts-count|bellCount/);
    const money = html.indexOf('data-testid="home-money"');
    const alerts = html.indexOf('data-testid="home-alerts"');
    const steps = html.indexOf('data-testid="home-steps"');
    expect(money).toBeGreaterThan(-1);
    expect(alerts).toBeGreaterThan(money);
    expect(steps).toBeGreaterThan(alerts);
    expect(html).toContain("مفيش تنبيهات دلوقتي");
  });
});

describe("The stocktake — short words", () => {
  const src = read("src/client/features/stocktake/StocktakeView.tsx");
  it("three short steps and four plain reasons", () => {
    for (const s of [
      "عدّ اللي موجود قدامك",
      "قارن الكمية باللي عند حِسبة",
      "راجع الفرق وأكّد الجرد",
      "الموجود في حِسبة:",
      "إنت عدّيت",
      "فيه فرق: ",
      "السبب؟",
    ])
      expect(src).toContain(s);
    const block = src.slice(
      src.indexOf("const SHORTAGE_CHOICES"),
      src.indexOf("const EXPIRED_CHOICE"),
    );
    expect(
      [...block.matchAll(/\["(\w+)", "([^"]+)"\]/g)].map((m) => m[2]),
    ).toEqual(["اتباع ومتسجلش", "تالف", "مفقود", "سبب آخر"]);
  });
});

describe("A shared link", () => {
  it("title, description, Open Graph and X card with the 1200×630 preview", () => {
    const m = siteMetadata(new URL("https://hesba.example"));
    expect(SITE_TITLE).toBe("حِسبة — إدارة محلك ببساطة");
    expect(m.description).toBe(SITE_DESCRIPTION);
    expect(m.metadataBase?.toString()).toBe("https://hesba.example/");
    expect(m.openGraph).toMatchObject({
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      siteName: "حِسبة",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
    const png = readFileSync(path.join(root, "public", OG_IMAGE.url));
    // PNG header: width and height (big-endian) at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(png.length).toBeLessThan(300_000); // WhatsApp skips heavy previews
  });

  it("the origin comes from the deployment, never from a request or a user", () => {
    expect(siteOrigin({ HESBA_APP_ORIGIN: "https://a.example" }).host).toBe(
      "a.example",
    );
    expect(
      siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "b.example" }).href,
    ).toBe("https://b.example/");
    expect(siteOrigin({ HESBA_APP_ORIGIN: "not a url" }).host).toBe(
      "localhost:3000",
    );
    const text = read("src/app/site-metadata.ts");
    expect(text).not.toMatch(/cookies\(|headers\(|session|storeId|userId/);
  });
});
