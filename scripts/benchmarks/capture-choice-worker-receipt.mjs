import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const [input, gameInput, output] = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(path, "utf8"));
const prior = read("benchmarks/tactical-relevance/built-worker-adapter104.json");
const report = read(input), game = read(gameInput);
const publicIds = new Set(prior.cases.map(row => row.id));
assert.equal(report.cases.length, publicIds.size);
const cases = report.cases.map(({ id, elapsedMs, startupMs, classificationMs, primary, matchesSource }) => {
  assert(publicIds.delete(id)); assert.equal(matchesSource, true);
  for (const time of [elapsedMs, startupMs, classificationMs]) assert(Number.isFinite(time) && time >= 0);
  assert(primary.every(theme => /^[A-Za-z0-9_]+$/.test(theme)));
  return { id, elapsedMs, startupMs, classificationMs, primary, matchesSource };
});
const contextIds = new Set(read("benchmarks/tactical-relevance/quiet-game-context-development.json").cases.flatMap(row => ["source", "best", "response"].map(lane => `${row.id}:${lane}`)));
const contexts = game.cases.map(({ id, lane, elapsedMs, startupMs, classificationMs, primary }) => {
  assert(contextIds.delete(`${id}:${lane}`));
  for (const time of [elapsedMs, startupMs, classificationMs]) assert(Number.isFinite(time) && time >= 0);
  assert(primary.every(theme => /^[A-Za-z0-9_]+$/.test(theme)));
  return { id, lane, elapsedMs, startupMs, classificationMs, primary };
});
assert.equal(publicIds.size, 0); assert.equal(contextIds.size, 0);
const changedPriorHeadlines = prior.cases.filter(old => JSON.stringify(old.primary) !== JSON.stringify(cases.find(row => row.id === old.id).primary)).map(row => row.id);
const times = [...cases, ...contexts].map(row => row.elapsedMs).sort((a,b) => a-b);
const timing = { count: times.length, medianMs: times[Math.floor(times.length/2)], p95Ms: times[Math.ceil(times.length*.95)-1], maxMs: times.at(-1), maxComputeMs: Math.max(...[...cases,...contexts].map(row => row.classificationMs)) };
writeFileSync(output, JSON.stringify({ scope: "Allowlisted public production-controller inputs. 808 retained inputs and 63 source/best/response inputs from 21 additional game boards. Timings exclude engine and rendered UI. Source parity and stability are not accuracy.", changedPriorHeadlines, timing, cases, contexts }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ changedPriorHeadlines, timing }));
