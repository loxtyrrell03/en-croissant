import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";

test("the pinned phone lite WASM reports version 19 and completes legal White/Black searches", { timeout: 30_000 }, async () => {
  // This runs the actual WASM through its upstream Node entry point. It does
  // not start a browser, phone session or production engine service.
  const engine = fileURLToPath(import.meta.resolve("stockfish/bin/stockfish-19-lite-single.js"));
  const child = spawn(process.execPath, [engine], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const reader = createInterface({ input: child.stdout });
  let pending = null, output = "", exited = false;
  const exit = new Promise((done) => child.once("exit", () => { exited = true; done(); }));
  reader.on("line", (line) => {
    output = (output + line + "\n").slice(-8192);
    pending?.(line);
  });
  const command = (text, match) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`WASM timed out: ${text}\n${output}`)), 10_000);
    const failure = (error) => finish(error instanceof Error ? error : new Error(`WASM exited: ${output}`));
    const finish = (error, line) => {
      clearTimeout(timer); pending = null;
      child.removeListener("exit", failure); child.removeListener("error", failure);
      if (error) reject(error); else resolve(line);
    };
    pending = (line) => { if (match(line)) finish(null, line); };
    child.once("exit", failure); child.once("error", failure);
    child.stdin.write(text + "\n");
  });
  try {
    await command("uci", (line) => line === "uciok");
    assert.match(output, /id name Stockfish 19/);
    child.stdin.write("setoption name Hash value 16\n");
    await command("isready", (line) => line === "readyok");
    for (const fen of [
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    ]) {
      child.stdin.write(`position fen ${fen}\n`);
      const result = await command("go depth 8", (line) => line.startsWith("bestmove "));
      const move = parseUci(result.split(/\s+/)[1]);
      assert.ok(move && Chess.fromSetup(parseFen(fen).unwrap()).unwrap().isLegal(move), result);
      assert.match(output, /info depth 8 .*score (cp|mate) -?\d+/);
    }
    child.stdin.write("quit\n");
    await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error("WASM did not quit")), 3000).unref())]);
    assert.equal(child.exitCode, 0);
  } finally {
    reader.close();
    if (!exited) { child.kill(); await exit; }
  }
});
