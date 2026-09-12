// Dedicated rendered-phone harness. All PC API writes except an explicitly
// requested live service toggle are intercepted; browser storage is isolated.
import { preview } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import("playwright").catch(() => import(pathToFileURL(resolve(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"))));

const live = process.argv.includes("--live");
const output = resolve("tmp/phone-services-qa");
await mkdir(output, { recursive: true });
const server = live ? null : await preview({ preview: { host: "127.0.0.1", port: 4389, strictPort: true } });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const errors = [], receipts = [];
page.on("pageerror", (error) => errors.push(error.message));
let enabled = false, failed = false;
const status = () => ({ ok: true, service: "en-croissant-service-controller", enabled, home: enabled && !failed, engine: enabled && !failed, busy: false, error: failed ? "Services could not start." : null });
try {
  await page.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === "/api/pc-services") {
      if (live) { if (req.method() === "POST") receipts.push(req.postDataJSON()); return route.continue(); }
      if (req.method() === "POST") { enabled = req.postDataJSON().enabled; receipts.push({ enabled }); }
      return route.fulfill({ status: failed ? 503 : 200, json: status() });
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/")) {
      if (req.method() !== "GET") return route.fulfill({ status: 200, json: { ok: true } });
      if (!live) return route.fulfill({ status: 404, json: { error: "Isolated UI fixture" } });
    }
    return route.continue();
  });
  await page.goto(live ? "https://windows-t8v5137.tail89d19b.ts.net/" : "http://127.0.0.1:4389/", { waitUntil: "domcontentloaded" });
  const section = page.getByRole("region", { name: "PC services", exact: true });
  const toggle = page.getByRole("switch", { name: "Turn PC services on or off" });
  await toggle.waitFor();
  console.log("Phone controls mounted");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Turn PC services on or off"]')?.disabled);
  if (live) {
    assert.equal(await toggle.isChecked(), true);
    await toggle.locator("..").click();
    await page.waitForFunction(() => document.querySelector('[aria-label="PC services"]')?.textContent.includes("PC analysis and reviews are stopped."), { timeout: 60_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await toggle.waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Turn PC services on or off"]')?.disabled);
    assert.equal(await toggle.isChecked(), false);
    await page.screenshot({ path: resolve(output, "live-off-after-reload.png") });
    await toggle.locator("..").click();
    await section.getByRole("status").filter({ hasText: "Ready" }).waitFor({ timeout: 60_000 });
  } else {
    assert.equal(await toggle.isChecked(), false);
    await toggle.locator("..").click();
    await section.getByRole("status").filter({ hasText: "Ready" }).waitFor();
    assert.deepEqual(receipts, [{ enabled: true }]);
    failed = true;
    await toggle.locator("..").click();
    await section.getByRole("alert").waitFor();
    assert.equal(await section.getByRole("status").textContent(), "Unavailable");
    failed = false;
    await section.getByRole("button", { name: "Retry" }).click();
    await toggle.locator("..").click();
    await section.getByRole("status").filter({ hasText: "Ready" }).waitFor();
  }
  await page.getByRole("button", { name: "About PC services" }).click();
  console.log("Toggle states verified");
  await page.getByText("Starts the PC engine and review server.", { exact: false }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByText("Starts the PC engine and review server.", { exact: false }).waitFor({ state: "hidden" });
  const switchPosition = await toggle.evaluate((input) => {
    const track = input.nextElementSibling, thumb = track.firstElementChild;
    return { checked: input.checked, track: track.getBoundingClientRect().toJSON(), thumb: thumb.getBoundingClientRect().toJSON() };
  });
  assert.equal(switchPosition.checked, true);
  assert.ok(switchPosition.thumb.left > switchPosition.track.left + switchPosition.track.width / 2, "On thumb must be on the right");
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Overflow at ${width}px`);
    const box = await toggle.locator("..").boundingBox();
    assert.ok(box.height >= 44, "Switch touch row needs 44px height");
    await page.screenshot({ path: resolve(output, `${live ? "live" : "preview"}-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("heading", { name: "Mistake review", exact: true }).waitFor();
  assert.equal(await toggle.isVisible(), true);
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, `${live ? "live" : "preview"}-result.json`), JSON.stringify({ errors, receipts, widths: [390, 320, 768] }, null, 2));
  console.log(JSON.stringify({ live, errors, receipts, output }));
} catch (error) {
  console.error(error.message);
  await page.screenshot({ path: resolve(output, "failed-check.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  // A failed live assertion must still restore the user's requested On state.
  if (live) await page.request.post("https://windows-t8v5137.tail89d19b.ts.net/api/pc-services", { headers: { "x-en-croissant-client": "phone-services" }, data: { enabled: true }, timeout: 60_000 }).catch(() => {});
  await browser.close();
  server?.httpServer.closeAllConnections();
  await new Promise((done) => server ? server.httpServer.close(done) : done());
}
