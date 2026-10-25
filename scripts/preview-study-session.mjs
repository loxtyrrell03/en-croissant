import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
const directory = path.resolve("tmp/study-session");
await fs.mkdir(directory, { recursive: true });
const plan = {
  schemaVersion: 1,
  id: "study-preview",
  title: "Daily study session",
  startDate: "2026-10-01",
  defaultMinutes: 60,
  steps: [
    {
      id: "patterns",
      title: "Tactical patterns — daily review",
      minutes60: 8,
      minutes90: 10,
      instructions: "Review known patterns before trying new ones. Example data.",
      resources: [],
    },
    {
      id: "calculation",
      title: "Slow calculation",
      minutes60: 10,
      minutes90: 15,
      instructions:
        "Compare candidates and calculate the strongest reply. Attach the exact exercise and record your lesson.",
      resources: [{ kind: "pgn", id: "exercise", title: "Example exercises", path: "example.pgn" }],
    },
    {
      id: "opening",
      title: "Opening understanding and preparation",
      minutes60: 12,
      minutes90: 20,
      instructions: "Recall the branch and explain its middlegame plan.",
      resources: [],
    },
    {
      id: "plans",
      title: "Positional decisions and review",
      minutes60: 8,
      minutes90: 12,
      instructions: "Choose a plan before reviewing the answer.",
      resources: [],
    },
    {
      id: "defence",
      title: "Practical defence and counterplay",
      minutes60: 5,
      minutes90: 10,
      instructions: "Find a defensive resource and review the strongest reply.",
      resources: [],
    },
    {
      id: "transfer",
      title: "Annotate one recent classical game",
      minutes60: 15,
      minutes90: 20,
      instructions:
        "Record one game and the location of your saved annotations. Example game, not owner data.",
      resources: [
        {
          kind: "web",
          id: "example-game",
          title: "Example game — review annotation status",
          url: "https://lichess.org/study/example",
          linked: true,
        },
      ],
    },
    {
      id: "log",
      title: "Session reflection",
      minutes60: 2,
      minutes90: 3,
      instructions: "Record the lesson and any unfinished work.",
      resources: [],
    },
  ],
  openingWeeks: [],
};
await fs.writeFile(path.join(directory, "preview-plan.json"), JSON.stringify(plan));
await fs.writeFile(
  path.join(directory, "preview-fs.ts"),
  `import plan from './preview-plan.json';export const exists=async()=>true;export const readTextFile=async(path:string)=>path.endsWith('daily-study-plan.json')?JSON.stringify(plan):'[Event "Example 1"]\\n[FEN "8/8/8/8/8/6k1/8/K7 w - - 0 1"]\\n\\n*';export const stat=async()=>({size:120});export const writeTextFile=async()=>{};export const rename=async()=>{};export const mkdir=async()=>{};export const readDir=async()=>[];`,
);
await fs.writeFile(
  path.join(directory, "preview-core.ts"),
  "export const isTauri=()=>false;export const invoke=async()=>{};",
);
await fs.writeFile(
  path.join(directory, "preview-path.ts"),
  'export const resolve=async(...parts:string[])=>parts.join("/");',
);
await fs.writeFile(
  path.join(directory, "preview-directories.ts"),
  'export const getDocumentDir=async()=>"/example-study";',
);
await fs.writeFile(
  path.join(directory, "preview.html"),
  '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Study session preview</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/preview.tsx"></script></body></html>',
);
await fs.writeFile(
  path.join(directory, "preview.tsx"),
  `import React from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider,Text,Button} from '@mantine/core';import '@mantine/core/styles.css';import Panel from '../../src/components/tabs/DailyStudyPlanPanel';createRoot(document.getElementById('root')!).render(<MantineProvider defaultColorScheme="dark"><main style={{maxWidth:980,margin:'auto',padding:16}}><Text size="xs" c="dimmed" mb="sm">Interactive source preview · invented example data · browser-only test storage</Text><Panel onOpenFile={async()=>{}}/></main></MantineProvider>);`,
);
const server = await createServer({
  root: directory,
  publicDir: false,
  configFile: false,
  cacheDir: path.join(directory, "vite-cache"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@/utils/directories", replacement: path.join(directory, "preview-directories.ts") },
      { find: "@tauri-apps/api/core", replacement: path.join(directory, "preview-core.ts") },
      { find: "@tauri-apps/api/path", replacement: path.join(directory, "preview-path.ts") },
      { find: "@tauri-apps/plugin-fs", replacement: path.join(directory, "preview-fs.ts") },
      { find: "@", replacement: path.resolve("src") },
    ],
  },
  optimizeDeps: { entries: ["preview.html"] },
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [path.resolve(".")] },
    watch: { ignored: ["**/src-tauri/**", "**/node_modules/**"] },
  },
});
await server.listen();
console.log(`http://127.0.0.1:${server.httpServer.address().port}/preview.html`);
