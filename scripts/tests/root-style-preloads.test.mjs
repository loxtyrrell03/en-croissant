import assert from "node:assert/strict";
import test from "node:test";
import { checkRootStylePreloads } from "../check-root-style-preloads.mjs";

const table =
  'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/App-a.css","assets/WebApp-b.css"])))=>i.map(i=>d[i]);';
const styles = { App: ["assets/App-a.css"], WebApp: ["assets/WebApp-b.css"] };

test("rejects the emitted conditional-import bug even when both CSS files exist", () => {
  const broken =
    table +
    'preload(native?()=>import("./App-a.js"):()=>import("./WebApp-b.js"),__vite__mapDeps([1]));';
  assert.throws(() => checkRootStylePreloads(broken, styles), /App does not preload/);
});

test("accepts separate root imports with their own stylesheet dependencies", () => {
  const fixed =
    table +
    'async function native(){return await preload(()=>import("./App-a.js"),__vite__mapDeps([0]));} async function web(){return await preload(()=>import("./WebApp-b.js"),__vite__mapDeps([1]));}';
  assert.deepEqual(checkRootStylePreloads(fixed, styles), [
    { root: "App", styles: styles.App, imports: 1 },
    { root: "WebApp", styles: styles.WebApp, imports: 1 },
  ]);
});

test("rejects a missing stylesheet or root instead of silently passing", () => {
  const fixed = table + 'preload(()=>import("./App-a.js"),__vite__mapDeps([0]));';
  assert.throws(
    () => checkRootStylePreloads(fixed, { App: [], WebApp: styles.WebApp }),
    /stylesheet is missing/,
  );
  assert.throws(() => checkRootStylePreloads(fixed, styles), /WebApp import is missing/);
});
