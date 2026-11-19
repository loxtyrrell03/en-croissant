import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { nominatePositionRefutation } from "@/utils/tacticalMotifs/decisionPositionContrast";
import positions from "./positions.json";
import deeper from "../tactical-recovery/deeper.json";

test("replays both decision axes from the same cached engine frames", () => {
    const played = deeper.map((row) => ({
        ...row,
        id: row.id + "-deep",
        normalControlled: undefined,
    }));
    const results = [...positions, ...played].map(({ id, normalControlled, ...input }) => {
        const nomination = nominatePositionRefutation(input.fen, input.candidates);
        const positionReply =
            nomination?.moveUci === normalControlled?.moveUci ? normalControlled : undefined;
        return { id, full: classify({ ...input, positionReply }, "Stockfish 19", input.history) };
    });
    writeFileSync(process.env.RECOVERY_OUTPUT!, JSON.stringify(results), { flag: "wx" });
}, 120_000);
