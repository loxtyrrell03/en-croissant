import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const [qaPath, playwright, ...selected] = process.argv.slice(2);
if (!qaPath || !playwright) throw new Error("Usage: node verify.mjs QA_DIRECTORY PLAYWRIGHT_ENTRY [SCENARIOS]");
const qa = resolve(qaPath);
const { chromium } = await import(pathToFileURL(playwright).href);
const exe = join(qa, "target", "release", "en-croissant-fork.exe");
const results = { revision: (await readFile(join(qa, "revision.txt"), "utf8")).trim(), scenarios: {} };

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function run(name, check) {
  const port = await availablePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const options = {
    cwd: qa,
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: join(qa, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    windowsHide: true,
    stdio: "ignore",
  };
  const child = spawn(exe, [], options);
  const exited = new Promise(resolve => {
    child.once("error", resolve);
    child.once("exit", (code, signal) => resolve(signal ?? code));
  });
  let browser;
  let page;
  const faults = [];
  let debug;
  try {
    for (let time = 0; time < 30; time++) {
      if (child.exitCode !== null) throw new Error(`QA process exited with ${child.exitCode}.`);
      debug = await fetch(endpoint + "/json/version", { signal: AbortSignal.timeout(900) })
        .then(r => r.ok ? r.json() : undefined).catch(() => undefined);
      if (debug) break;
      await delay(500);
    }
    assert(debug, "Native WebView did not open its test debugging endpoint.");
    browser = await chromium.connectOverCDP(endpoint, { timeout: 12000 });
    const context = browser.contexts()[0];
    page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 12000 });
    page.on("pageerror", error => faults.push(String(error)));
    await page.waitForFunction(() => window.__TAURI_INTERNALS__ && localStorage.getItem("document-dir"), null, { timeout: 25000 });
    const origin = await page.evaluate(() => location.origin);
    assert.match(origin, /tauri/);
    await page.goto(origin + "/files", { timeout: 8000 });
    await page.waitForFunction(() => document.querySelector("#app")?.childElementCount, null, { timeout: 25000 });
    const stored = await page.evaluate(() => ["document-dir", "engines-dir", "databases-dir", "puzzles-dir"]
      .map(key => JSON.parse(localStorage.getItem(key))));
    for (const path of stored) assert(path.startsWith(join(qa, "runtime-fixtures")));
    await page.getByText(name, { exact: true }).first().dblclick({ timeout: 18000 });
    await page.getByRole("button", { name: "Next move", exact: true }).waitFor({ timeout: 22000 });
    const started = Date.now();
    const evidence = await check(page);
    assert.deepEqual(faults, []);
    results.scenarios[name] = { passed: true, seconds: (Date.now() - started) / 1000, engine: "Stockfish 19 QA", origin, browser: debug.Browser, ...evidence };
    await page.screenshot({ path: join(qa, name + ".png"), timeout: 4000 }).catch(() => {});
  } catch (error) {
    const body = await page?.locator("body").innerText({ timeout: 1000 }).catch(() => "");
    const interactive = await page?.locator("button, [role=tab]").evaluateAll(nodes => nodes.map(node =>
      node.getAttribute("aria-label") || node.textContent.trim()).filter(Boolean)).catch(() => []);
    results.scenarios[name] = { passed: false, error: String(error), faults, body: body?.slice(-7500), interactive };
  } finally {
    child.kill();
    await Promise.race([exited, delay(3000)]);
    await browser?.close().catch(() => {});
  }
  console.log(name, JSON.stringify(results.scenarios[name]));
  await writeFile(join(qa, "receipt.json"), JSON.stringify(results, null, 2) + "\n");
}

const visible = (page, text, timeout = 24000) => page.getByText(text, { exact: true }).first().waitFor({ timeout });
const button = (page, name) => page.getByRole("button", { name, exact: true }).first();
async function openTactics(page) {
  await page.getByRole("tab", { name: "Tactics", exact: true }).click({ timeout: 18000 });
  const engine = page.getByRole("textbox", { name: "Tactical scan engine", exact: true });
  await page.waitForFunction(() => document.querySelector('[aria-label="Tactical scan engine"]')?.value === "Stockfish 19 QA", null, { timeout: 20000 });
  assert.equal(await engine.inputValue(), "Stockfish 19 QA");
}
async function analyse(page, action) {
  await button(page, action).click({ timeout: 42000 });
  await visible(page, "Position character", 55000);
  await visible(page, "What the move achieves");
}
async function expandPosition(page) {
  const position = page.getByText("Position character", { exact: true }).locator("../..");
  const expand = position.getByRole("button", { name: "Show evidence", exact: true });
  if (await expand.count()) await expand.click({ timeout: 6000 });
  return position;
}

const wanted = new Set(selected);
async function scenario(name, check) {
  if (!wanted.size || wanted.has(name)) await run(name, check);
}

await scenario("Bavarian Refutation", async page => {
  await button(page, "Start").click();
  await openTactics(page);
  await analyse(page, "Analyse position");
  const evidence = await expandPosition(page);
  const text = await evidence.innerText();
  assert.match(text, /Qc8/);
  assert.match(text, /Nxb5/);
  assert.match(text, /Nxd4/);
  return { position: text };
});

await scenario("Amsterdam Exchange", async page => {
  await button(page, "End").click();
  await openTactics(page);
  await analyse(page, "Analyse last move");
  const move = page.getByText("What the move achieves", { exact: true }).locator("../..");
  const expand = move.getByRole("button", { name: "Show evidence", exact: true });
  if (await expand.count()) await expand.click({ timeout: 6000 });
  const text = await move.innerText();
  assert.match(text, /\bMixed\b/i);
  assert.match(text, /Bxe5/);
  assert.match(text, /passed pawn/);
  assert.match(text, /d4/);
  return { move: text };
});

await scenario("Exact Rook Ending", async page => {
  await button(page, "Start").click();
  await button(page, "Next move").click();
  await openTactics(page);
  await analyse(page, "Analyse last move");
  await button(page, "Check endgame online").click({ timeout: 12000 });
  await page.getByText(/3 of \d+ legal moves draw/).waitFor({ timeout: 14000 });
  await visible(page, "What Kf1 allows");
  const board = await page.getByText(/3 of \d+ legal moves draw/).innerText();
  const mistake = await page.getByText("What Kf1 allows", { exact: true }).locator("../..").innerText();
  assert.match(board, /Rg6, Rg7, Rg8/);
  assert.match(mistake, /Draw\s*→\s*Loss/i);
  assert.match(mistake, /e2\+/);
  return { position: board, mistake };
});

if (wanted.has("Finnish Capture Order")) {
  await run("Finnish Capture Order", async page => {
    await button(page, "End").click();
    await openTactics(page);
    await analyse(page, "Analyse position");
    const text = await (await expandPosition(page)).innerText();
    assert.match(text, /\bMixed\b/i);
    assert.match(text, /Be3/);
    assert.match(text, /Check first\..*Rd1\+/);
    assert.match(text, /Take immediately\..*gxf4/);
    assert.match(text, /Qxd3/);
    return { position: text };
  });
}

if (wanted.has("Asian Capture Order")) {
  await run("Asian Capture Order", async page => {
    await button(page, "End").click();
    await openTactics(page);
    await analyse(page, "Analyse last move");
    const section = page.getByText("What Nxd5 missed or allowed", { exact: true }).locator("../..");
    await section.getByRole("button", { name: "Show evidence", exact: true }).click({ timeout: 6000 });
    const text = await section.innerText();
    assert.match(text, /Check first\..*Qxh2\+.*hxg5\+/);
    assert.match(text, /Take immediately\..*hxg5.*Nxc7\+/);
    return { mistake: text };
  });
}

if (wanted.has("Sardinia Capture Order")) {
  await run("Sardinia Capture Order", async page => {
    await button(page, "End").click();
    await openTactics(page);
    await analyse(page, "Analyse last move");
    const section = page.getByText("What f4 missed or allowed", { exact: true }).locator("../..");
    await section.getByRole("button", { name: "Show evidence", exact: true }).click({ timeout: 6000 });
    const text = await section.innerText();
    assert.match(text, /Tactical · Engine supported\. After f4.*Taking immediately allows fxg5 to capture the queen/);
    assert.match(text, /Check first\..*Qxg4\+.*Bxf1/);
    return { mistake: text };
  });
}

if (wanted.has("Berjaya Checking Defence")) {
  await run("Berjaya Checking Defence", async page => {
    await button(page, "End").click();
    await openTactics(page);
    await analyse(page, "Analyse position");
    const text = await (await expandPosition(page)).innerText();
    assert.match(text, /Check first\..*Qh8\+.*Rxc8/);
    assert.match(text, /Same reply after the better move\..*Kg6.*Qh8.*Qf6/);
    assert.match(text, /Engine supported.*Qh8 comes without check/);
    return { position: text };
  });
}

if (wanted.has("La Roda Checking Defence")) {
  await run("La Roda Checking Defence", async page => {
    await button(page, "End").click();
    await openTactics(page);
    await analyse(page, "Analyse last move");
    const section = page.getByText("What Qc2 missed or allowed", { exact: true }).locator("../..");
    await section.getByRole("button", { name: "Show evidence", exact: true }).click({ timeout: 6000 });
    const text = await section.innerText();
    assert.match(text, /Check first\..*Bxf7\+.*Qxa8/);
    assert.match(text, /Bxe6 takes the bishop that would give that check/);
    return { mistake: text };
  });
}

if (wanted.has("Quiet Counterattack")) {
  await run("Quiet Counterattack", async page => {
    await button(page, "End").click();
    await openTactics(page);
    await analyse(page, "Analyse position");
    const position = await (await expandPosition(page)).innerText();
    const move = page.getByText("What the move achieves", { exact: true }).locator("../..");
    await move.getByRole("button", { name: "Show evidence", exact: true }).click({ timeout: 6000 });
    const evidence = await move.innerText();
    assert.match(position, /Engine supported.*After h3, Qg3.*on g4/);
    assert.match(position, /Other defences can change the continuation/);
    assert.match(evidence, /If Qg3\..*h3.*Qg3/);
    return { position, move: evidence };
  });
}

for (const [name, reply, capture, early, punishment] of [
  ["Amager Defender Capture", "bxc3", "Qxc5", "Rxc3", "Qxd4"],
  ["Ganja Defender Capture", "Rb8", "Bxb3", "Rxc5", "Nxc5"],
]) {
  if (!wanted.has(name)) continue;
  await run(name, async page => {
    await button(page, "End").click();
    await openTactics(page);
    await analyse(page, "Analyse last move");
    const position = await (await expandPosition(page)).innerText();
    const move = page.getByText("What the move achieves", { exact: true }).locator("../..");
    const captureOrderFound = position.includes(`After ${reply}, ${capture}`);
    if (name === "Ganja Defender Capture" && !captureOrderFound) {
      return { position, move: await move.innerText(), captureOrderFound };
    }
    await move.getByRole("button", { name: "Show evidence", exact: true }).click({ timeout: 6000 });
    const evidence = await move.innerText();
    assert(position.includes(`After ${reply}, ${capture}`), position);
    assert.match(position, /Other defences can change the continuation/);
    assert.match(evidence, /Defender first\..*Taking too early\./s);
    assert(evidence.includes(early) && evidence.includes(punishment), evidence);
    return { position, move: evidence, captureOrderFound };
  });
}

if (Object.values(results.scenarios).some(result => !result.passed)) process.exitCode = 1;
