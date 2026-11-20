import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import replay from "../current-classifier-audit/replay.config.mjs";

const source = "src/utils/tacticalMotifs/decisionAssessment.ts";
const absolute = resolve(source).replaceAll("\\", "/");
const marker = "    return {\n        version: DECISION_ASSESSMENT_VERSION,";
const candidate = `
    const exactPlayed = comparison[playedIndex];
    if (playedIndex > 0 && playedBoard &&
        comparedBest.pvUci[0] === first.pvUci[0] &&
        comparisonMeasured?.lines.length === comparison.length &&
        !moves.some(move => afterChoice(move.moveUci) === playedBoard)) {
        const assessment = assessMove({ ...input, candidates: comparison, quietReply: undefined }, exactPlayed);
        moves.push({
            ...assessment, moveUci: exactPlayed.pvUci[0], evaluationCp: exactPlayed.cp, depth: exactPlayed.depth,
        });
    }
`;

const probe = {
  name: "paired-exact-annotation-target",
  enforce: "pre",
  load(id) {
    if (id.split("?")[0].replaceAll("\\", "/") !== absolute) return null;
    const code = execFileSync("git", ["show", `cc956cb1:${source}`], { encoding: "utf8" });
    if (code.split(marker).length !== 2) throw new Error("Expected one assessment return.");
    return code.replace(marker, candidate + marker);
  },
};

export default { ...replay, plugins: [probe, ...replay.plugins] };
