// Headless sweep of every page at desktop and phone widths, in the light and the dark theme.
// Fails on horizontal overflow, page errors or console errors. Screenshots go to e2e/out/.
// Usage: BASE_URL=http://localhost:3000 node e2e/sweep.mjs   (needs `next dev`, which serves /dev/fixtures)
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const WIDTHS = [1280, 375];
const SCHEMES = (process.env.SCHEMES ?? "light,dark").split(",");
const PAGES = [
  { name: "home", path: "/" },
  { name: "topics", path: "/topics" },
  { name: "topics-past", path: "/topics?state=archived" },
  { name: "login", path: "/login" },
  { name: "admin", path: "/admin" },
  { name: "privacy", path: "/privacy" },
  { name: "terms", path: "/terms" },
  { name: "ui", path: "/dev/ui" },
  { name: "flood", path: "/dev/fixtures/flood" },
  { name: "outage", path: "/dev/fixtures/outage" },
  { name: "cyber", path: "/dev/fixtures/cyber" },
  { name: "studio-flood", path: "/dev/fixtures/flood?view=studio" },
  { name: "studio-cyber", path: "/dev/fixtures/cyber?view=studio" },
  { name: "mine-flood", path: "/dev/fixtures/flood?view=mine" },
  { name: "mine-outage", path: "/dev/fixtures/outage?view=mine" },
];
// The basemap comes from openfreemap.org; a slow tile is not a page bug.
const IGNORE = [/openfreemap\.org/, /Download the React DevTools/, /\[HMR\]/, /\[Fast Refresh\]/];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const scheme of SCHEMES) for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 800 }, deviceScaleFactor: 1, colorScheme: scheme });
    for (const p of PAGES) {
      const page = await context.newPage();
      const errors = [];
      page.on("console", (m) => {
        if (m.type() === "error" && !IGNORE.some((re) => re.test(m.text()) || re.test(m.location()?.url ?? ""))) errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      // Not networkidle: a board with a map keeps fetching tiles.
      const res = await page.goto(BASE + p.path, { waitUntil: "load", timeout: 60_000 }).catch((e) => {
        errors.push(`navigation: ${e.message}`);
        return null;
      });
      if (res && !res.ok()) errors.push(`HTTP ${res.status()}`);
      await page.waitForTimeout(p.path.includes("/dev/fixtures/") ? 4000 : 1200);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        if (doc.scrollWidth <= doc.clientWidth + 1) return null;
        const wide = [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).split(" ").slice(0, 3).join(".")}`);
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, wide };
      });
      if (overflow) errors.push(`horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}: ${overflow.wide.join(", ")}`);
      const file = path.join(OUT, `${p.name}-${width}-${scheme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const status = errors.length ? "FAIL" : "ok";
      console.log(`${status.padEnd(4)} ${String(width).padStart(4)} ${scheme.padEnd(5)} ${p.path}${errors.length ? `\n     ${errors.join("\n     ")}` : ""}`);
      if (errors.length) failures.push({ width, scheme, path: p.path, errors });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const total = PAGES.length * WIDTHS.length * SCHEMES.length;
console.log(`\n${total - failures.length}/${total} passed. Screenshots in ${OUT}`);
process.exit(failures.length ? 1 : 0);
