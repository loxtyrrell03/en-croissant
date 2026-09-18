import { describe, expect, test } from "vitest";
import { observeCaptureAttractionIdea, observeEscapeConcession, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { buildMistakeReviewTacticalExplanation, classifyPositionTacticalMotifs, isImmediateTacticalLesson, tacticalMotifPerspective } from "../tacticalMotifs/mistakeReviewAdapter";
import { captureAttractionIdeaFen as fen, captureAttractionIdeaLine as line } from "./fixtures/captureAttractionIdea";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

describe("capture attraction observations", () => {
    test.each([false, true])("connects the exchange to the checking entry and every direct retreat (%s)", reflected => {
        const steps = replayTacticalLine(reflected ? reflectMixedForkFen(fen) : fen,
            reflected ? line.map(reflectMixedForkMove) : line);
        const observation = observeCaptureAttractionIdea(steps);
        expect(steps).toHaveLength(7);
        expect(observation).not.toBeNull();
        expect(observation!.proof.flights).toHaveLength(3);
        expect(observation!.opened).toHaveLength(1);
        expect(observeCaptureAttractionIdea(steps, 1)).toBeNull();
        expect(observeCaptureAttractionIdea(steps.slice(0, 4))).toBeNull();
    });

    test.each([
        ["extra rook can recapture", fen.replace("r2qk3", "rr1qk3")],
        ["rook already unguarded", fen.replace("r2qk3", "r3k3")],
        ["unsettled checking counterplay", fen.replace("pbp1p3", "1b6").replace("np6", "n7")],
        ["expensive queen offer", fen.replace("1B2", "1Q2")],
    ])("withholds the observation: %s", (_name, board) => {
        const steps = replayTacticalLine(board, line);
        expect(steps).toHaveLength(7);
        expect(observeCaptureAttractionIdea(steps)).toBeNull();
    });

    test("shows only the conditional root idea and current-board exchange arrows", () => {
        const scan = buildLiveTacticalScan({fen, pvUci: line, engineName: "test", depth: 18,
            variations: [{pvUci: line, cp: 300, depth: 18}]});
        expect(scan.motifs[0]).toMatchObject({id: "attractionIdea", value: 0, ply: 1, confidence: "medium"});
        expect(scan.motifs[0].evidence).toContain("not proof that every defence loses");
        expect(scan.arrows.map(a => `${a.from}${a.to}`)).toEqual(["f1a6", "b7a6"]);
        expect(scan.labels[0]).toMatchObject({text: "Attraction Idea", square: "a6"});
        expect(scan.variations[0].timeline.some(m => m.id === "hangingPiece")).toBe(false);
    });

    test("requires scored relevance and cannot establish a missed or allowed mistake", () => {
        for (const rootCp of [undefined, null, NaN, Infinity, -101])
            expect(classifyPositionTacticalMotifs({fen, pvUci: line, rootCp}).motifs.some(m => m.id === "attractionIdea")).toBe(false);
        const motif = classifyPositionTacticalMotifs({fen, pvUci: line, rootCp: 300}).motifs[0];
        expect(motif.id).toBe("attractionIdea");
        expect(isImmediateTacticalLesson(motif)).toBe(false);
        expect(tacticalMotifPerspective(motif)).toBe("Conditional idea");
        for (const source of ["allowed", "missed"] as const) {
            const classification = {allowedMotifs: source === "allowed" ? [{...motif, source}] : [],
                missedMotifs: source === "missed" ? [{...motif, source}] : []};
            const explanation = buildMistakeReviewTacticalExplanation(classification);
            expect(explanation?.title).toBe(source === "missed" ? "Idea in the better line" : "Idea after the move");
            expect(explanation?.text).toContain("does not establish why the played move was worse");
        }
        const loss = {...motif, id: "hangingPiece", label: "Hanging Piece", source: "allowed" as const,
            value: 900, confidence: "high" as const, comparison: "prevented" as const};
        expect(buildMistakeReviewTacticalExplanation({allowedMotifs: [loss], missedMotifs: [{...motif, source: "missed"}]})?.primary.id).toBe("hangingPiece");
    });

    test("retreat evidence debits the preparing pawn rather than calling every bishop capture free", () => {
        const root = replayTacticalLine(fen, line)[4];
        const proof = observeEscapeConcession(root, 40)!;
        expect(proof.flights.find(f => f.reply === "a6b5")?.gain).toBe(230);
        expect(proof.flights.find(f => f.reply === "a6b7")?.gain).toBe(330);
        expect(proof.flights.find(f => f.reply === "a6c8")?.gain).toBe(500);
    });

    test("an independently established fork preparation keeps priority", () => {
        const result = classifyPositionTacticalMotifs({fen: fen.replace("np6", "n7"), pvUci: line, rootCp: 300});
        expect(result.motifs[0].id).toBe("forkPreparation");
        expect(result.motifs.some(m => m.id === "attractionIdea")).toBe(false);
    });

    test("an attractive accepting line does not override contrary engine relevance", () => {
        // The earlier reduced draft allows ...Rxa6; its actual held score was
        // -340 cp. The cooperative bishop acceptance still has the geometry,
        // but is not sufficient to surface this losing candidate.
        const draft = fen.replace("pbp1p3", "1bp1p3").replace("np6", "n7");
        expect(observeCaptureAttractionIdea(replayTacticalLine(draft, line))).not.toBeNull();
        expect(classifyPositionTacticalMotifs({fen: draft, pvUci: line, rootCp: -340}).motifs.some(m => m.id === "attractionIdea")).toBe(false);
    });
});
