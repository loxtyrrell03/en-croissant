import { readFileSync, writeFileSync } from "node:fs";
import { makeFen, parseFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { makeUci, parseSquare, parseUci } from "chessops/util";
import { expect, test } from "vitest";
import {
    replayTacticalLine,
    proveMatingSelfInterference,
    proveXRaySupport,
    intermediateCaptureProof,
    tacticalBoardEvidence,
    auditTacticalMotifs,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fixture = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/secondary-theme-development.json", "utf8"),
);

test("frozen engine and source inputs retain unrelated judgements across the full secondary sample", () => {
    const receipt = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/secondary-theme-stockfish-18.json", "utf8"),
    );
    const clean = (value: unknown) =>
        JSON.stringify(value, (key, entry) =>
            key === "motifClassifierVersion" ? undefined : entry && typeof entry === "object" && !Array.isArray(entry)
                ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry,
        );
    const changed = new Set(["lichess:qQG5v", "lichess:sKDBG", "lichess:xxDaj", "lichess:SD5oo", "lichess:qn2Fy", "lichess:j8Up4", "lichess:S9vEb", "lichess:DBBd9", "lichess:J3vOR", "lichess:R13Ct", "lichess:oSj8l"]);
    const cases = receipt.cases.map((r: any) => {
        const sourceResult = classifyPositionTacticalMotifs({
            fen: r.fen,
            pvUci: r.sourceUci,
            pvSan: r.sourceSan,
            rootCp: r.sourceEngine.cp,
            previousFen: r.previousFen,
            previousMoveUci: r.previousMoveUci,
        });
        const scan = buildLiveTacticalScan({
            fen: r.fen,
            pvUci: r.engineLines[0].pvUci,
            variations: r.engineLines,
            depth: 16,
            engineName: "Stockfish 18",
            previousFen: r.previousFen,
            previousMoveUci: r.previousMoveUci,
        });
        expect({
            id: r.id,
            unchangedOrReviewed:
                changed.has(r.id) ||
                (clean(sourceResult) === clean(r.sourceResult) && clean(scan) === clean(r.scan)),
        }).toEqual({ id: r.id, unchangedOrReviewed: true });
        expect(scan.motifs[0]?.id).toBe(
            r.id === "lichess:SD5oo" ? "mateIn2" : r.id === "lichess:qn2Fy" ? "trappedPiece" : r.id === "lichess:J3vOR" ? "interference" : r.scan.motifs[0]?.id,
        );
        return { ...r, sourceResult, scan };
    });
    // ...Kxf7 retains its capture lesson, but Nxd6+ Qxd6 trades a
    // 320 knight for a 330 bishop: debit that available counterplay.
    const recapture = cases.find((row: any) => row.id === "lichess:R13Ct")!;
    expect(recapture.sourceResult.motifs[0]).toMatchObject({ id: "hangingPiece", label: "Winning Recapture", value: 210 });
    expect(recapture.scan.motifs[0]).toMatchObject({ id: "hangingPiece", value: 210 });
    // The fork includes the eventual queen collection; promotion itself earns
    // only knight-minus-pawn, not a second copy of the whole combination.
    const promotedFork = cases.find((row: any) => row.id === "lichess:oSj8l")!;
    expect(promotedFork.sourceResult.motifs[0]).toMatchObject({ id: "fork", value: 1120, ply: 1 });
    expect(promotedFork.sourceResult.motifs).toContainEqual(expect.objectContaining({
        id: "underPromotion", value: 220, confidence: "high", relevance: "secondary", ply: 1,
    }));
    if (process.env.TACTICAL_SECONDARY_FINAL_REPORT)
        writeFileSync(
            process.env.TACTICAL_SECONDARY_FINAL_REPORT,
            JSON.stringify(
                {
                    scope: "Exact engine/source-input replay. Mechanism changes were reviewed across adapters 92 through 94; adapter 117 additionally debits R13Ct's minor-piece counterexchange. Unchanged/empty outputs are not accuracy successes.",
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});

test("legally replays the output-blind secondary-theme sample without treating source tags as truth", () => {
    expect(fixture.cases).toHaveLength(18);
    const cases = fixture.cases.map(
        (row: {
            id: string;
            startFen: string;
            sourceFen: string;
            precedingMove: string;
            bestLine: string[];
        }) => {
            const preceding = replayTacticalLine(row.sourceFen, [row.precedingMove]);
            expect(preceding).toHaveLength(1);
            const steps = replayTacticalLine(row.startFen, row.bestLine);
            expect(steps).toHaveLength(row.bestLine.length);
            // Chessops omits an uncapturable en-passant square when serializing.
            expect(makeFen(preceding[0].after.toSetup())).toBe(makeFen(steps[0].before.toSetup()));
            return {
                ...row,
                fen: row.startFen,
                sourceUci: row.bestLine,
                sourceSan: steps.map((s) => s.san),
                previousFen: row.sourceFen,
                previousMoveUci: row.precedingMove,
                sourceResult: classifyPositionTacticalMotifs({
                    fen: row.startFen,
                    pvUci: row.bestLine,
                }),
                scan: buildLiveTacticalScan({
                    fen: row.startFen,
                    pvUci: row.bestLine,
                    depth: 16,
                    engineName: "Source continuation",
                }),
            };
        },
    );
    if (process.env.TACTICAL_SECONDARY_REPORT)
        writeFileSync(
            process.env.TACTICAL_SECONDARY_REPORT,
            JSON.stringify(
                {
                    scope: "Development outputs, not eighteen correct answers. Source tags and initial human hypotheses are not proof.",
                    sourceSha256: fixture.sourceSha256,
                    selection: fixture.selection,
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});

const row = (id: string) =>
    fixture.cases.find((r: { id: string }) => r.id === `lichess:${id}`) as {
        startFen: string;
        bestLine: string[];
    };
const classify = (id: string, rootOnly = false) => {
    const r = row(id);
    return classifyPositionTacticalMotifs({
        fen: r.startFen,
        pvUci: rootOnly ? r.bestLine.slice(0, 1) : r.bestLine,
    });
};

test.each([false, true])(
    "forced mate cannot be sold as extra material from an intermediate capture (root-only %s)",
    (rootOnly) => {
        const r = row("SD5oo"),
            step = replayTacticalLine(r.startFen, r.bestLine)[0];
        expect(intermediateCaptureProof(step)).toBeNull();
        const result = classify("SD5oo", rootOnly);
        expect(result.motifs[0]).toMatchObject({ id: "mateIn2", label: "Forcing Mate", ply: 1 });
        expect(result.motifs.map((m) => m.id)).not.toContain("intermezzo");
        expect(result.timeline?.find((m) => m.id === "xRayAttack")).toMatchObject({
            ply: 1,
            label: "X-Ray Support",
            relevance: "secondary",
        });
        expect(result.timeline?.some((m) => m.id === "backRankMate" && m.ply === 3)).toBe(
            !rootOnly,
        );
    },
);

test("the king's mating self-interference stays on its actual defensive ply", () => {
    const r = row("qQG5v"),
        steps = replayTacticalLine(r.startFen, r.bestLine);
    expect(proveMatingSelfInterference(steps[3])).toMatchObject({
        mate: true,
        captureSan: "Qxg7#",
    });
    const result = classify("qQG5v");
    expect(result.motifs[0]).toMatchObject({ id: "mateIn3", ply: 1 });
    const detail = result.timeline!.find((m) => m.id === "selfInterference")!;
    expect(detail).toMatchObject({ ply: 4, actor: "black", relevance: "secondary" });
    expect(detail.evidence).toContain("not a tactic won by Black");
    expect(tacticalBoardEvidence(r.startFen, r.bestLine, detail)).toEqual({
        square: "g5",
        arrows: [
            { from: "g4", to: "g5" },
            { from: "h8", to: "g7" },
        ],
    });
    expect(classify("qQG5v", true).timeline?.some((m) => m.id === "selfInterference")).toBe(false);
    const defending = classifyPositionTacticalMotifs({
        fen: makeFen(steps[3].before.toSetup()),
        pvUci: r.bestLine.slice(3),
    });
    expect(defending.motifs.some((m) => m.id === "selfInterference")).toBe(false);
});

test.each(["sKDBG", "SD5oo", "xxDaj"])(
    "x-ray support has exact recapture geometry without future payoff labels: %s",
    (id) => {
        const r = row(id),
            steps = replayTacticalLine(r.startFen, r.bestLine);
        expect(proveXRaySupport(steps[0])).not.toBeNull();
        const result = classify(id);
        const detail = result.timeline!.find((m) => m.id === "xRayAttack")!;
        expect(detail).toMatchObject({
            ply: 1,
            moveUci: r.bestLine[0],
            confidence: "high",
            label: "X-Ray Support",
        });
        expect(result.timeline!.filter((m) => m.id === "xRayAttack")).toHaveLength(1);
        expect(detail.evidence).toContain("If ");
        expect(detail.evidence).not.toContain("appears on");
        expect(result.motifs[0].label).toBe(id === "xxDaj" ? "X-Ray Support" : "Forcing Mate");
        expect(detail.value).toBe(id === "xxDaj" ? 500 : undefined);
    },
);

test("the material x-ray uses the real guarding ray without a duplicate loose-piece badge", () => {
    const r = row("xxDaj"),
        result = classify("xxDaj");
    expect(result.motifs.map((m) => m.id)).toEqual(["xRayAttack"]);
    expect(tacticalBoardEvidence(r.startFen, r.bestLine, result.motifs[0])).toEqual({
        square: "c7",
        arrows: [
            { from: "c8", to: "c7" },
            { from: "c7", to: "c2" },
        ],
    });
});

function reflected(fen: string, line: string[], flip: number) {
    const setup = parseFen(fen).unwrap(),
        original = setup.board;
    setup.board = original.clone();
    setup.board.clear();
    for (const [square, piece] of original)
        setup.board.set((square ^ flip) as Square, {
            ...piece,
            color: flip & 56 ? (piece.color === "white" ? "black" : "white") : piece.color,
        });
    if (flip & 56) setup.turn = setup.turn === "white" ? "black" : "white";
    if (setup.epSquare !== undefined) setup.epSquare = (setup.epSquare ^ flip) as Square;
    const moves = line.map((uci) => {
        const move = parseUci(uci)!;
        if (!("from" in move)) throw new Error("Unexpected drop");
        return makeUci({
            ...move,
            from: (move.from ^ flip) as Square,
            to: (move.to ^ flip) as Square,
        });
    });
    return { fen: makeFen(setup), pvUci: moves };
}

test.each([7, 56, 63])(
    "rare mechanism and primary judgement survive board reflection %s",
    (flip) => {
        for (const id of ["sKDBG", "SD5oo", "xxDaj", "qQG5v"]) {
            const r = row(id),
                input = reflected(r.startFen, r.bestLine, flip);
            const result = classifyPositionTacticalMotifs(input);
            expect(result.motifs[0].id).toBe(classify(id).motifs[0].id);
            expect(result.timeline!.map((m) => [m.id, m.ply])).toEqual(
                classify(id).timeline!.map((m) => [m.id, m.ply]),
            );
        }
    },
);

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "invalid/exhausted rare-theme budgets abstain: %s",
    (limit) => {
        const mate = row("qQG5v"),
            xray = row("xxDaj");
        expect(
            proveMatingSelfInterference(replayTacticalLine(mate.startFen, mate.bestLine)[3], limit),
        ).toBeNull();
        expect(
            proveXRaySupport(replayTacticalLine(xray.startFen, xray.bestLine)[0], limit),
        ).toBeNull();
    },
);

test.each(["g4", "e7"])(
    "a missing old guard or an escape square prevents mating self-interference: %s",
    (square) => {
        const r = row("qQG5v"),
            setup = replayTacticalLine(r.startFen, r.bestLine)[3].before.toSetup();
        setup.board.take(parseSquare(square)!);
        const steps = replayTacticalLine(makeFen(setup), ["h6g5", "h8g7"]);
        expect(steps).toHaveLength(2);
        expect(proveMatingSelfInterference(steps[0])).toBeNull();
    },
);

test.each(["c8", "c7"])("an absent slider or receiver prevents the x-ray claim: %s", (square) => {
    const r = row("xxDaj"),
        setup = parseFen(r.startFen).unwrap();
    setup.board.take(parseSquare(square)!);
    const steps = replayTacticalLine(makeFen(setup), [r.bestLine[0]]);
    expect(steps).toHaveLength(1);
    expect(proveXRaySupport(steps[0])).toBeNull();
});

test("an additional blocker prevents the rook's advertised recapture", () => {
    const r = row("xxDaj"),
        setup = parseFen(r.startFen).unwrap();
    setup.board.take(parseSquare("c7")!);
    setup.board.set(parseSquare("c6")!, { color: "white", role: "queen" });
    setup.board.set(parseSquare("c7")!, { color: "black", role: "pawn" });
    const steps = replayTacticalLine(makeFen(setup), ["b2c2", "c6c2", "c8c2"]);
    expect(steps).toHaveLength(2);
    expect(proveXRaySupport(steps[0])).toBeNull();
});

test("a profitable PV or terminal mate cannot finance a fabricated x-ray", () => {
    for (const [fen, line] of [
        ["4k3/8/8/8/8/8/q7/R3K3 w - - 0 1", ["a1a2"]],
        [row("qQG5v").startFen, row("qQG5v").bestLine],
    ] as const) {
        const result = auditTacticalMotifs(
            fen,
            [...line],
            [
                {
                    id: "xRayAttack",
                    label: "X-Ray Attack",
                    source: "available",
                    confidence: "high",
                    ply: 1,
                    moveUci: line[0],
                    evidence: "Unsupported source tag",
                    value: 10000,
                },
            ],
        );
        expect(result.some((m) => m.id === "xRayAttack")).toBe(false);
    }
});

test("an off-square rook liability prevents a material x-ray certificate", () => {
    const r = row("xxDaj"),
        setup = parseFen(r.startFen).unwrap();
    setup.board.take(parseSquare("g2")!);
    setup.board.take(parseSquare("e6")!);
    setup.board.set(parseSquare("g1")!, { color: "white", role: "king" });
    setup.board.set(parseSquare("f5")!, { color: "white", role: "bishop" });
    const steps = replayTacticalLine(makeFen(setup), ["b2c2", "f5c8"]);
    expect(steps).toHaveLength(2);
    expect(proveXRaySupport(steps[0])).toBeNull();
});

test("a second legal recapturer defeats the alleged mating interference", () => {
    const r = row("qQG5v"),
        setup = replayTacticalLine(r.startFen, r.bestLine)[3].before.toSetup();
    setup.board.set(parseSquare("g8")!, { color: "black", role: "rook" });
    const steps = replayTacticalLine(makeFen(setup), ["h6g5", "h8g7", "g8g7"]);
    expect(steps).toHaveLength(3);
    expect(proveMatingSelfInterference(steps[0])).toBeNull();
});

test("missed mate and material lessons keep their real primary cause and secondary timeline", () => {
    for (const [id, played, primary] of [
        ["qQG5v", "g1g2", "mateIn3"],
        ["SD5oo", "e8e6", "mateIn2"],
        ["xxDaj", "c8e8", "xRayAttack"],
    ]) {
        const r = row(id),
            review = classifyMistakeReviewMotifs({
                fen: r.startFen,
                playedMoveUci: played,
                bestMoveUci: r.bestLine[0],
                pvUci: r.bestLine,
            });
        expect(review.missedMotifs[0]).toMatchObject({ id: primary, ply: 1, source: "missed" });
        expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
            id: primary,
            source: "missed",
        });
        expect(
            review.missedTimeline?.some((m) => m.id === "selfInterference" && m.ply === 4) ?? false,
        ).toBe(id === "qQG5v");
    }
});
