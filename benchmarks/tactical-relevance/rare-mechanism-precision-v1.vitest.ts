import base from "../../vite.config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const ref = process.env.RARE_MECHANISM_PRECISION_REF ?? "9fad2cd685d88d10e962bd80384eb9aaf117072e";
if (ref !== "index" && !/^[0-9a-f]{40}$/.test(ref)) throw new Error("Use an exact committed SHA or index");
const loaded = new Map<string, string>();
const source = (path: string) => execFileSync("git", ["show", `${ref === "index" ? "" : ref}:${path}`], { encoding: "utf8", maxBuffer: 8000000 });
const hash = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const frozen = {
  name: "rare-mechanism-precision-pinned-source", enforce: "pre" as const,
  load(id: string) {
    const normalized = id.replaceAll("\\", "/").split("?")[0], at = normalized.indexOf("/src/utils/tacticalMotifs/");
    if (at < 0 || !normalized.endsWith(".ts")) return;
    const path = normalized.slice(at + 1), text = source(path);
    loaded.set(path, hash(text));
    return text;
  },
  closeBundle() {
    if (!loaded.size) throw new Error("Pinned source loader was not used");
    for (const [path, original] of loaded) if (hash(source(path)) !== original) throw new Error(`Pinned source changed: ${path}`);
    if (process.env.RARE_MECHANISM_PRECISION_LOADER_REPORT) writeFileSync(process.env.RARE_MECHANISM_PRECISION_LOADER_REPORT,
      JSON.stringify({ ref, loaded: Object.fromEntries(loaded), unchanged: true }, null, 2), { flag: "wx" });
  },
};
export default { ...base, plugins: [frozen, ...(base.plugins ?? [])], test: { ...base.test,
  include: ["benchmarks/tactical-relevance/rare-mechanism-precision-v1.test.ts", "src/utils/tests/rareMechanismPrecision.test.ts"] } };
