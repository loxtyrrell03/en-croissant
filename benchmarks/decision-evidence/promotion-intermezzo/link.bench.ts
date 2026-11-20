import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { extractTacticalSequenceWitnesses } from "@/utils/tacticalMotifs/tacticalSequenceEvidence";

type Row = { id: string; fen: string; sourcePath: string[] };
test("tracks legal intermezzos and whether they explain the root promotion", () => {
    const { rows } = JSON.parse(readFileSync(process.env.REPLY_BUDGET_INPUT!, "utf8")) as {
        rows: Row[];
    };
    const result = rows.map(({ id, fen, sourcePath }) => ({
        id,
        witnesses: extractTacticalSequenceWitnesses(fen, {
            fen,
            cp: 0,
            depth: 1,
            pvUci: sourcePath,
        }).filter((item) => item.mechanism === "intermezzo"),
    }));
    writeFileSync(process.env.REPLY_BUDGET_OUTPUT!, JSON.stringify(result), { flag: "wx" });
});
