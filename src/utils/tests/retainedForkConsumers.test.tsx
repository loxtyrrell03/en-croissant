import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TacticalLineExplanation } from "@/components/panels/tactics/TacticalLineExplanation";
import { positionSchema } from "@/components/files/opening";
import { classifyMistakeReviewNature } from "../mistakeReview";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    isRetainedForkChoice,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

const fen = "1k1q3r/pppp4/3N3N/8/2B5/8/5PPP/6K1 w - - 0 1";
function input(reflected: boolean) {
    const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
    return {
        fen: reflected ? reflectMixedForkFen(fen) : fen,
        bestMoveUci: flip("d6f7"),
        playedMoveUci: flip("h6f7"),
        pvUci: ["d6f7", "d8e7", "f7h8"].map(flip),
        refutationUci: [flip("d8e7")],
    };
}

test.each([false, true])("retained fork is neutral after deck serialization, reflected=%s", reflected => {
    const classification = classifyMistakeReviewMotifs(input(reflected));
    const saved = positionSchema.shape.mistakeReview.parse(JSON.parse(JSON.stringify(classification)))!;
    const result = {
        allowedMotifs: saved.allowedMotifs ?? [],
        missedMotifs: saved.missedMotifs ?? [],
    };
    expect(result.missedMotifs.some(isRetainedForkChoice)).toBe(true);
    expect(saved.missedTimeline?.some(isRetainedForkChoice)).toBe(true);
    const explanation = buildMistakeReviewTacticalExplanation(result)!;
    expect(explanation.title).toBe("Both moves create this fork");
    expect(explanation.text).not.toMatch(/you missed|also missed/i);
    expect(explanation.secondary).toBeUndefined();
});

test.each([false, true])("retained fork alone cannot establish tactical mistake nature, reflected=%s", reflected => {
    // No score is needed to prove the fork was actually played. A larger
    // synthetic loss also cannot turn that shared mechanism into a cause.
    for (const cpLoss of [undefined, 200]) {
        const nature = classifyMistakeReviewNature({ ...input(reflected), cpLoss });
        expect(nature.nature).toBe("unknown");
        expect(nature.tacticalSignals).toEqual([]);
        expect(nature.reason).toContain("Both moves create");
    }
});

test("line details show both-moves context instead of a missed-fork accusation", () => {
    const result = classifyMistakeReviewMotifs(input(false));
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
        <MantineProvider>
            <TacticalLineExplanation moves={["Ndf7", "Qe7", "Nxh8"]} motifs={result.missedTimeline ?? []} />
        </MantineProvider>,
    );
    const root = container.querySelector('[data-tactical-ply="1"]');
    expect(root?.textContent).toContain(result.missedMotifs.find(isRetainedForkChoice)!.comparisonEvidence!);
    expect(root?.textContent).not.toMatch(/you missed|also missed/i);
});
