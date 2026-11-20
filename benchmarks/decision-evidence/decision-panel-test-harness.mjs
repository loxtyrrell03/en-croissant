import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "vite";
import react from "@vitejs/plugin-react";

export async function verifyDecisionPanel({
  input,
  previousSan,
  assessment,
  baseline,
  prepare,
  verify,
  description,
}) {
  const [playwrightModule, chrome] = process.argv.slice(2);
  const { chromium } = await import(pathToFileURL(resolve(playwrightModule)));
  const pinned = new Map(
    ["decisionAssessment.ts", "causalTactics.ts", "tacticalMistakeEpisode.ts"].map((name) => {
      const version = name === "decisionAssessment.ts" ? assessment : baseline;
      const path = `src/utils/tacticalMotifs/${name}`;
      return [
        name,
        execFileSync("git", ["show", version === "index" ? ":" + path : version + ":" + path], {
          encoding: "utf8",
        }),
      ];
    }),
  );

  const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { MantineProvider } from "@mantine/core";
  import "@mantine/core/styles.css";
  import { DecisionEvidencePanel } from "/src/components/panels/tactics/DecisionEvidencePanel.tsx";
  const props = { engine: { id: "fixture", name: "Stockfish 19", settings: [] }, previous: { fen: ${JSON.stringify(input.fen)}, playedMoveUci: ${JSON.stringify(input.playedMoveUci)}, history: ${JSON.stringify(input.history)} }, previousSan: ${JSON.stringify(previousSan)} };
  createRoot(document.getElementById("qa")).render(<MantineProvider><DecisionEvidencePanel {...props} /></MantineProvider>);
`;

  function fixturePlugin() {
    return {
      name: "decision-played-three-panel",
      enforce: "pre",
      resolveId(id) {
        if (id === "played-three-panel-entry.jsx" || id === "played-three-panel-search")
          return "\0" + id;
      },
      load(id) {
        if (id === "\0played-three-panel-entry.jsx") return entry;
        if (id === "\0played-three-panel-search")
          return `
        export const DECISION_SEARCH_SESSION_MS = 28000;
        export async function gatherDecisionEvidence() {
          ${input.forceFailure ? 'throw new Error("No completed engine result.");' : ""}
          return ${JSON.stringify(input)};
        }
        export async function gatherExtraPositionChoice() { return null; }
        export async function gatherSiblingRefutation() { return ${JSON.stringify(input.fixtureSiblingRefutation)}; }
        export async function gatherCheckingOrder() { return ${JSON.stringify(input.fixtureCheckingOrder)}; }
        export async function gatherQuietReply() { return ${JSON.stringify(input.fixtureQuietReply)}; }
        export async function gatherCaptureOrder() { return ${JSON.stringify(input.fixtureCaptureOrder)}; }
        export async function gatherCaptureRouteReply() { return ${JSON.stringify(input.fixtureCaptureRouteReply)}; }
        export async function gatherCheckingDefence() { return null; }
        export async function gatherPassedAdvance() { return []; }
        export async function gatherPreparedCheckpoint() { return []; }
      `;
        return pinned.get(id.replaceAll("\\", "/").split("/").at(-1)) ?? null;
      },
      transform(code, id) {
        if (id.endsWith("/DecisionEvidencePanel.tsx"))
          return code.replace('from "./decisionSearch"', 'from "played-three-panel-search"');
      },
    };
  }

  const result = await build({
    configFile: false,
    resolve: { alias: { "@": resolve("src") } },
    build: {
      write: false,
      reportCompressedSize: false,
      rollupOptions: { input: "played-three-panel-entry.jsx" },
    },
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
      response.end(
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          styles.map((style) => `<link rel="stylesheet" href="/${style.fileName}">`).join("") +
          `<main id="qa" style="padding:8px"></main><script type="module" src="/${script.fileName}"></script>`,
      );
      return;
    }
    const file = files.get(resource);
    if (!file) {
      response.statusCode = 404;
      response.end();
      return;
    }
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
      await prepare?.(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.getByRole("button", { name: "Analyse last move" }).click();
      await verify(page);
      if (
        errors.length ||
        (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      )
        throw new Error(`Panel failed at ${width}px. ${errors.join("\n")}`);
      await page.close();
      console.log(`${description} verified at ${width}px`);
    }
  } finally {
    await browser?.close();
    server.close();
  }
}
