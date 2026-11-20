import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "vite";
import react from "@vitejs/plugin-react";

const [playwrightModule, chrome] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)));
const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const board = fixtures.passedPawn;
const changed = new Set(["decisionAssessment.ts", "decisionCheckingDefence.ts"]);
const pinned = new Map([
  ...changed, "causalTactics.ts", "tacticalMistakeEpisode.ts"
].map((name) => {
  const version = changed.has(name) ? (process.env.DEFENCE_REVISION ?? "HEAD") : "ae566ad5";
  const path = `src/utils/tacticalMotifs/${name}`;
  return [name, execFileSync("git", ["show", version === "index" ? ":" + path : version + ":" + path], { encoding: "utf8" })];
}));

const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { MantineProvider } from "@mantine/core";
  import "@mantine/core/styles.css";
  import { DecisionEvidencePanel } from "/src/components/panels/tactics/DecisionEvidencePanel.tsx";
  const props = { engine: { id: "fixture", name: "Stockfish 19", settings: [] }, previous: { fen: ${JSON.stringify(board.input.fen)}, playedMoveUci: "c6d7" }, previousSan: "Kd7" };
  createRoot(document.getElementById("qa")).render(<MantineProvider><DecisionEvidencePanel {...props} /></MantineProvider>);
`;

function fixturePlugin() {
  return {
    name: "decision-checking-defence-panel",
    enforce: "pre",
    resolveId(id) {
      if (id === "checking-defence-panel-entry.jsx" || id === "checking-defence-panel-search") return "\0" + id;
    },
    load(id) {
      if (id === "\0checking-defence-panel-entry.jsx") return entry;
      if (id === "\0checking-defence-panel-search") return `
        export const DECISION_SEARCH_SESSION_MS = 28000;
        export async function gatherDecisionEvidence() {
          return ${JSON.stringify(board.input)};
        }
        export async function gatherExtraPositionChoice() { return null; }
        export async function gatherCheckingDefence(_engine, _target, request, signal, deadline) {
          signal.throwIfAborted();
          const expected = ${JSON.stringify(board.expectedBoards)};
          if (Date.now() >= deadline || request.better.fen !== expected[0] || request.played.fen !== expected[1] ||
              request.captures.length !== 1 || request.captures[0] !== "f7e7")
            throw new Error("Unexpected defensive capture request");
          return ${JSON.stringify(board.checkingDefence)};
        }
        export async function gatherPassedAdvance(_engine, _target, request, signal, deadline) {
          signal.throwIfAborted();
          const replies = ${JSON.stringify(board.passedAdvance)};
          if (Date.now() >= deadline || request.advance !== "d6d7" ||
              replies.some((reply, index) => reply.fen !== request.checks[index]?.fen))
            throw new Error("Unexpected passed-pawn request");
          return replies;
        }
        export async function gatherPreparedCheckpoint() { return []; }
      `;
      return pinned.get(id.replaceAll("\\", "/").split("/").at(-1)) ?? null;
    },
    transform(code, id) {
      if (id.endsWith("/DecisionEvidencePanel.tsx"))
        return code.replace('from "./decisionSearch"', 'from "checking-defence-panel-search"');
    },
  };
}

const result = await build({
  configFile: false,
  resolve: { alias: { "@": resolve("src") } },
  build: { write: false, reportCompressedSize: false, rollupOptions: { input: "checking-defence-panel-entry.jsx" } },
  worker: { plugins: () => [fixturePlugin()] },
  plugins: [react(), fixturePlugin()],
});
const files = new Map(result.output.map((file) => [file.fileName, file]));
const script = result.output.find((file) => file.type === "chunk" && file.isEntry);
const styles = result.output.filter((file) => file.fileName.endsWith(".css"));
const server = createServer((request, response) => {
  const resource = new URL(request.url, "http://localhost").pathname.slice(1);
  if (!resource) {
    response.setHeader("Content-Type", "text/html");
    response.end('<meta name="viewport" content="width=device-width,initial-scale=1">' +
      styles.map((style) => `<link rel="stylesheet" href="/${style.fileName}">`).join("") +
      `<main id="qa" style="padding:8px"></main><script type="module" src="/${script.fileName}"></script>`);
    return;
  }
  const file = files.get(resource);
  if (!file) { response.statusCode = 404; response.end(); return; }
  response.setHeader("Content-Type", resource.endsWith(".css") ? "text/css" : "text/javascript");
  response.end(file.type === "chunk" ? file.code : file.source);
});

let browser;
try {
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const width of [320, 390, 900]) {
    const page = await browser.newPage({ viewport: { width, height: 750 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(12_000);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole("button", { name: "Analyse last move" }).click();
    const panel = page.getByText("What Kd7 missed or allowed", { exact: true }).locator("../..");
    await panel.getByText("Mixed", { exact: true }).first().waitFor();
    await panel.getByText(/Kd7, Re7\+ cannot be met with Rxe7\+/).waitFor();
    await panel.getByText(/passed pawn on d6 reaches d7/).waitFor();
    const toggle = panel.getByRole("button", { name: "Show evidence" });
    await toggle.focus();
    await toggle.press("Enter");
    await panel.getByText(/Rf7 Re7 Rxe7\+/).waitFor();
    await panel.getByText(/d7 Bxd7/).waitFor();
    await panel.getByText(/If the pawn advances in line 2.*d7 Rxd7/).waitFor();
    await panel.getByRole("button", { name: "Hide evidence" }).click();
    if (errors.length || await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(`Panel failed at ${width}px. ${errors.join("\n")}`);
    await page.close();
    console.log(`Mixed report and both passed-pawn continuations verified at ${width}px`);
  }
} finally {
  await browser?.close();
  server.close();
}
