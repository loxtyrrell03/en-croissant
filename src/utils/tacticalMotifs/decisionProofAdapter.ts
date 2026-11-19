import { parseSan } from "chessops/san";
import { makeSquare, makeUci } from "chessops/util";
import { proveExchangeDeflection, replayTacticalLine } from "./causalTactics";
import type { TacticalMotifEvidence } from "./types";

export type DecisionLocalProof = {
    mechanism: "overloading";
    underlyingMechanisms: ["deflection"];
    purpose: "gain-material";
    fen: string;
    moveUci: string;
    defender: string;
    targets: string[];
    materialGainPoints: number;
    branches: Array<{ response: "accept" | "decline"; lineUci: string[]; lineSan: string[] }>;
    support: "bounded-proof";
    limitation: string;
};

/** Preserve the mature local proof library, but distinguish multiple duties
 * (overloading) from the resulting displacement (deflection). This does not
 * infer a new motif from explanation text or static attack geometry. */
export function refineDecisionCertificates(
    fen: string,
    moveUci: string,
    certificates: TacticalMotifEvidence[],
) {
    const motifs = certificates.map((motif) => ({ ...motif }));
    const proofs: DecisionLocalProof[] = [];
    if (
        !motifs.some(
            (motif) => motif.id === "deflection" && motif.ply === 1 && motif.moveUci === moveUci,
        )
    )
        return { motifs, proofs };
    const root = replayTacticalLine(fen, [moveUci])[0];
    if (!root) return { motifs, proofs };
    const proof = proveExchangeDeflection(root);
    if (!proof) return { motifs, proofs };
    const branch = (response: "accept" | "decline", san: string[]) => {
        const position = root.after.clone();
        const lineUci = [moveUci];
        for (const text of san) {
            const move = parseSan(position, text);
            if (!move || !position.isLegal(move)) return null;
            lineUci.push(makeUci(move));
            position.play(move);
        }
        return { response, lineUci, lineSan: [root.san, ...san] };
    };
    const accept = branch("accept", proof.acceptance),
        decline = branch("decline", proof.recovery);
    if (!accept || !decline) return { motifs, proofs };
    const defender = makeSquare(proof.defender),
        targets = [makeSquare(proof.target), makeSquare(proof.secondary)];
    proofs.push({
        mechanism: "overloading",
        underlyingMechanisms: ["deflection"],
        purpose: "gain-material",
        fen,
        moveUci,
        defender,
        targets,
        materialGainPoints: proof.gain / 100,
        branches: [accept, decline],
        support: "bounded-proof",
        limitation:
            "Every immediate legal defence was checked within the bounded material proof. This is not an unlimited-depth game-theoretic result.",
    });
    return {
        proofs,
        motifs: motifs.map((motif) =>
            motif.id !== "deflection" || motif.ply !== 1 || motif.moveUci !== moveUci
                ? motif
                : {
                      ...motif,
                      id: "overloading",
                      label: "Overloading",
                      value: proof.gain,
                      verifiedCombination: true as const,
                      evidence: `${root.san} exploits the defender on ${defender}, which cannot maintain both duties involving ${targets.join(" and ")}. Accepting: ${accept.lineSan.join(" ")}. Declining: ${decline.lineSan.join(" ")}. These are separate checked branches, with a local material gain of at least ${proof.gain / 100} points. Deflection is the underlying mechanism.`,
                  },
        ),
    };
}
