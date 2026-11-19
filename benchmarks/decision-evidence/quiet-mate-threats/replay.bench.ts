import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import development from "./development.json";
import reserve from "./reserve.json";

test("compares quiet mating threats on identical exact search inputs", () => {
    const inputPath = process.env.THREAT_INPUT;
    const rows = inputPath
        ? JSON.parse(readFileSync(inputPath, "utf8"))
        : [...development, ...reserve];
    const output = rows.map(({ id, ...input }) => ({
        id,
        report: classify(input, "Stockfish 19", input.history),
    }));
    writeFileSync(process.env.THREAT_OUTPUT!, JSON.stringify(output), { flag: "wx" });
}, 240_000);
