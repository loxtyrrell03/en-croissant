import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "vite";
import react from "@vitejs/plugin-react";

const [playwrightModule, chrome] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)));
const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const board = fixtures.gatherDefensiveResource;
const pinned = new Map(
  ["decisionAssessment.ts", "causalTactics.ts", "tacticalMistakeEpisode.ts"].map((name) => {
    const path = `src/utils/tacticalMotifs/${name}`;
    const ref =
      name === "decisionAssessment.ts" ? (process.env.DRAW_FRAME_REVISION ?? "HEAD") : "e64555d2";
    return [
      name,
      execFileSync("git", ["show", ref === "index" ? ":" + path : ref + ":" + path], {
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
  const props = { engine: { id: "fixture", name: "Stockfish 19", settings: [] }, current: ${JSON.stringify({ fen: board.fen, history: board.history })} };
  createRoot(document.getElementById("qa")).render(<MantineProvider><DecisionEvidencePanel {...props} /></MantineProvider>);
`;

function fixturePlugin() {
  return {
    name: "decision-draw-validation-panel",
    enforce: "pre",
    resolveId(id) {
      if (id === "draw-validation-panel-entry.jsx") return "\0" + id;
      if (id === "draw-validation-bindings" || id === "draw-validation-engines") return "\0" + id;
    },
    load(id) {
      if (id === "\0draw-validation-panel-entry.jsx") return entry;
      if (id === "\0draw-validation-bindings")
        return "export const events = { bestMovesPayload: { listen: async () => () => {} } };";
      if (id === "\0draw-validation-engines")
        return `
        const data = ${JSON.stringify(board)};
        export async function killEngine() {}
        export async function getBestMoves(_engine, _tab, _mode, options) {
          if (options.searchMoves?.length) throw new Error("Unexpected restricted search in the fixture");
          const root = options.moves.length === data.history.moves.length;
          const records = root ? data.candidates : data.replyProbes[0].lines;
          const sign = root ? -1 : 1;
          return [100, records.map((row, index) => ({
            depth: row.depth, multipv: index + 1, uciMoves: row.pvUci, sanMoves: [],
            score: { value: row.mate == null ? { type: "cp", value: sign * row.cp }
              : { type: "mate", value: sign * row.mate }, wdl: null },
          }))];
        }`;
      return pinned.get(id.replaceAll("\\", "/").split("/").at(-1)) ?? null;
    },
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/decisionSearch.ts"))
        return code
          .replace('from "@/bindings"', 'from "draw-validation-bindings"')
          .replace('from "@/utils/engines"', 'from "draw-validation-engines"');
    },
  };
}

const result = await build({
  configFile: false,
  resolve: { alias: { "@": resolve("src") } },
  build: {
    write: false,
    reportCompressedSize: false,
    rollupOptions: { input: "draw-validation-panel-entry.jsx" },
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
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole("button", { name: "Analyse position" }).click();
    const panel = page.getByText("Position character", { exact: true }).locator("../..");
    try {
      await panel.getByText("Tactical", { exact: true }).first().waitFor();
    } catch (error) {
      throw new Error((await page.locator("body").innerText()) + "\n" + errors.join("\n"), {
        cause: error,
      });
    }
    await panel.getByText(/Kg1 allows mate.*Re1.*prefers Kh3/).waitFor();
    const toggle = panel.getByRole("button", { name: "Show evidence" });
    await toggle.focus();
    await toggle.press("Enter");
    await panel
      .getByText(/Kg1 allows mate.*Re1/)
      .first()
      .waitFor();
    await panel.getByRole("button", { name: "Hide evidence" }).click();
    if (
      errors.length ||
      (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    )
      throw new Error(`Panel failed at ${width}px. ${errors.join("\n")}`);
    await page.close();
    console.log(`Decision search and defensive tactic verified at ${width}px`);
  }
} finally {
  await browser?.close();
  server.close();
}
