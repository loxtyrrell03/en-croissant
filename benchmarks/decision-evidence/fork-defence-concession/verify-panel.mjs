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
const board = fixtures.checking;
const pinned = new Map(["decisionAssessment.ts", "causalTactics.ts", "tacticalMistakeEpisode.ts"].map((name) => [
  name, execFileSync("git", ["show", `6481d4e9:src/utils/tacticalMotifs/${name}`], { encoding: "utf8" })
    .replace("DECISION_ASSESSMENT_VERSION = 38", "DECISION_ASSESSMENT_VERSION = 39"),
]));
const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { MantineProvider } from "@mantine/core";
  import "@mantine/core/styles.css";
  import { DecisionEvidencePanel } from "/src/components/panels/tactics/DecisionEvidencePanel.tsx";
  const props = { engine: { id: "fixture", name: "Stockfish 19", settings: [] }, current: { fen: ${JSON.stringify(board.fen)} } };
  createRoot(document.getElementById("qa")).render(<MantineProvider><DecisionEvidencePanel {...props} /></MantineProvider>);
`;

function fixturePlugin() {
  return {
    name: "decision-fork-panel",
    enforce: "pre",
    resolveId(id) {
      if (id === "fork-panel-entry.jsx" || id === "fork-panel-search") return "\0" + id;
    },
    load(id) {
      if (id === "\0fork-panel-entry.jsx") return entry;
      if (id === "\0fork-panel-search") return `
        export const DECISION_SEARCH_SESSION_MS = 28000;
        export async function gatherDecisionEvidence() {
          return ${JSON.stringify({
            fen: board.fen, candidates: board.paired, replyProbes: board.withReplies,
          })};
        }
        export async function gatherExtraPositionChoice() { return null; }
        export async function gatherPreparedCheckpoint() { return []; }
      `;
      return pinned.get(id.replaceAll("\\", "/").split("/").at(-1)) ?? null;
    },
    transform(code, id) {
      if (id.endsWith("/DecisionEvidencePanel.tsx"))
        return code.replace('from "./decisionSearch"', 'from "fork-panel-search"');
    },
  };
}

const result = await build({
  configFile: false,
  resolve: { alias: { "@": resolve("src") } },
  build: { write: false, reportCompressedSize: false, rollupOptions: { input: "fork-panel-entry.jsx" } },
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
    await page.getByRole("button", { name: "Analyse position" }).click();
    for (const title of ["Position character", "What the move achieves"]) {
      const panel = page.getByText(title, { exact: true }).locator("../..");
      await panel.getByText("Tactical", { exact: true }).first().waitFor();
      const toggle = panel.getByRole("button", { name: "Show evidence" });
      await toggle.focus();
      await toggle.press("Enter");
      await panel.getByText(/Fork if Kf7/).waitFor();
      await panel.getByText(/Bf6\+ Qxf6 exf6\+/).waitFor();
      await panel.getByText(/retains at least 4\.7 material points/).waitFor();
      await panel.getByRole("button", { name: "Hide evidence" }).click();
    }
    if (errors.length || await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(`Panel failed at ${width}px. ${errors.join("\n")}`);
    await page.close();
    console.log(`Both fork replies and their material consequence verified at ${width}px`);
  }
} finally {
  await browser?.close();
  server.close();
}
