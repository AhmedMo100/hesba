// Renders the social-sharing preview (`public/og-image.png`, 1200×630) from Hesba's own logo,
// colours and font. A real browser draws it, so the Arabic text is shaped correctly (letters
// joined, right to left). Run after changing the logo or the wording:
//
//   node scripts/make-og-image.mjs
//
// The texts must match `src/app/site-metadata.ts`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const b64 = (p) => readFileSync(path.join(root, p)).toString("base64");

const logo = `data:image/png;base64,${b64("public/logo.png")}`;
const font = (w) =>
  `@font-face{font-family:Tajawal;font-weight:${w};src:url(data:font/woff2;base64,${b64(
    `public/fonts/tajawal/tajawal-${w}-arabic.woff2`,
  )}) format("woff2");}`;

const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
${font(500)}${font(800)}
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px}
body{font-family:Tajawal,sans-serif;background:#efe8d6;color:#1f3326;display:flex;align-items:center;
  justify-content:center;gap:72px;padding:0 96px;position:relative;overflow:hidden}
.mark{flex:none;width:300px;height:300px;border-radius:72px;background:#f7f4ec;display:flex;
  align-items:center;justify-content:center;box-shadow:0 10px 40px rgba(31,51,38,.10)}
.mark img{height:236px}
.text{display:flex;flex-direction:column;gap:22px;max-width:640px}
h1{font-size:112px;font-weight:800;line-height:1}
h2{font-size:52px;font-weight:800;line-height:1.2}
p{font-size:34px;font-weight:500;line-height:1.45;color:#3b5e47}
.bar{position:absolute;inset-inline:0;bottom:0;height:18px;background:#1f3326}
.bar::after{content:"";position:absolute;inset-block:0;inset-inline-start:0;width:220px;background:#c8a470}
</style></head><body>
<div class="mark"><img src="${logo}" alt=""></div>
<div class="text">
  <h1>حِسبة</h1>
  <h2>إدارة محلك ببساطة</h2>
  <p>اعرف فلوسك وبضاعتك وديونك ومكسبك من مكان واحد.</p>
</div>
<div class="bar"></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({
  path: path.join(root, "public/og-image.png"),
  type: "png",
});
await browser.close();
console.log("public/og-image.png written");
