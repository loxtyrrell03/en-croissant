import { expect, test } from "vitest";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import {
    confirmPasserFlight,
    nominatePasserFlight,
    selectPasserFlightCheck,
} from "@/utils/tacticalMotifs/decisionPasserFlight";
import fixture from "./fixture.json";

const { input, frames } = fixture;
const [stronger, weaker] = input.comparisonCandidates;
const replies = input.replyProbes.find((probe) => probe.moveUci === input.playedMoveUci)!.lines;
const request = nominatePasserFlight(input.fen, stronger, weaker, replies, input.history)!;

test("the rook cuts off the actual king flights after the common check", () => {
    expect(request.better.prefix).toEqual(["d2b2", "b6b7"]);
    expect(request.played.prefix).toEqual(["d2d4", "b6b7"]);
    expect(request.flights.get("d5e3")).toHaveLength(2);
    expect(selectPasserFlightCheck(request, frames.shallow.better)?.pvUci[0]).toBe("d5e3");
});

test("both actual weak payoffs corroborate the stronger move's pawn defence", () => {
    for (const data of Object.values(frames)) {
        const evidence = confirmPasserFlight(request, data);
        expect(evidence?.episode.explanation).toContain("Rb2 covers e2");
        expect(evidence?.rookPlan).toContain("rook on b2");
    }
    expect(confirmPasserFlight(request, frames.shallow)?.episode.explanation).toContain(
        "takes the checking piece",
    );
    expect(confirmPasserFlight(request, frames.repeat)?.episode.explanation).toContain(
        "promotes the pawn",
    );
});

test("geometry and a favourable score alone do not validate a tactic", () => {
    const { better, played } = frames.shallow;
    expect(
        confirmPasserFlight(request, { better, played: { ...played, fen: input.fen } }),
    ).toBeNull();
    expect(confirmPasserFlight(request, { better, played: { ...played, cp: 0 } })).toBeNull();
    expect(
        confirmPasserFlight(request, {
            better,
            played: { ...played, pvUci: played.pvUci.slice(0, 2) },
        }),
    ).toBeNull();
    expect(
        confirmPasserFlight(request, {
            better: better.map((line) => ({ ...line, pvUci: line.pvUci.slice(0, 3) })),
            played,
        }),
    ).toBeNull();
});

test("the worker shows a mixed defence and a tactical mistake with the two lines", () => {
    const report = classify(
        { ...input, passerFlight: frames.shallow },
        "Stockfish 19",
        input.history,
    );
    const baseline = classify(input, "Stockfish 19", input.history);
    expect(report?.moves[0].category).toBe("mixed");
    expect(report?.moves[0].passerFlight?.linesUci).toHaveLength(2);
    expect(report?.mistake?.category).toBe("tactical");
    expect(report?.mistake?.tacticalEpisode?.playedLineUci.slice(0, 4)).toEqual([
        "d2d4",
        "b6b7",
        "d5e3",
        "f1e2",
    ]);
    expect(report?.position).toEqual(baseline?.position);
});
