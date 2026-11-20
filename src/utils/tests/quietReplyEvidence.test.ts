import { describe, expect, it } from "vitest";
import fixture from "../../../benchmarks/decision-evidence/quiet-reply-counterplay/fixture.json";
import { assessChessDecision } from "../tacticalMotifs/decisionAssessment";
import { confirmQuietReply, nominateQuietReply, nominateUnsearchedQuietReply } from "../tacticalMotifs/quietReplyEvidence";

describe("a quiet defence with a tactical drawback", () => {
    it("explains the exact candidate when the new defender still loses the original piece", () => {
        const { input, probe } = fixture.heldout;
        const before = assessChessDecision(input)!;
        const after = assessChessDecision({ ...input, quietReply: probe })!;
        const exact = after.moves.find(move => move.moveUci === probe.rootMoveUci)!;
        expect(exact.quietReply?.explanation).toMatch(/After h3, Qg3.*on g4/);
        expect(exact.tactical.support).toBe("supported");
        expect(after.position.quietReply).toEqual(exact.quietReply);
        expect(after.position.limitations).toContain("The resource applies to this reply. Other defences can change the continuation.");
        expect(after.moves.filter(move => move.moveUci !== probe.rootMoveUci))
            .toEqual(before.moves.filter(move => move.moveUci !== probe.rootMoveUci));
        expect(after.mistake).toEqual(before.mistake);
    });

    it("combines independent strategic support with an exact tactical reply on a viable alternative", () => {
        const { input, probe } = fixture.nearBest;
        const before = assessChessDecision(input)!;
        const after = assessChessDecision({ ...input, quietReply: probe })!;
        expect(before.position.category).toBe("positional");
        expect(after.position.category).toBe("mixed");
        expect(after.position.positional).toEqual(before.position.positional);
        expect(after.position.quietReply?.moveUci).toBe("b5b4");
        expect(after.moves[0]).toEqual(before.moves[0]);
    });

    it("keeps a separate diagnosis of Nxd5 when the stronger move gains conditional evidence", () => {
        const { input, probe, playedError } = fixture.heldout;
        const recorded = { ...input, ...playedError };
        const before = assessChessDecision(recorded)!;
        const after = assessChessDecision({ ...recorded, quietReply: probe })!;
        expect(before.mistake).not.toBeNull();
        expect(after.mistake).toEqual(before.mistake);
        expect(after.position.quietReply?.moveUci).toBe("h2h3");
    });

    it("models several profitable answers without claiming a unique move order", () => {
        const { input, probe } = fixture.pawnAttack;
        const question = nominateQuietReply(input.fen, input.candidates[0], probe.replies, input.history)!;
        const proof = confirmQuietReply(question, probe.answers, input.history)!;
        expect(proof.lineUci.slice(0, 2)).toEqual(["g2g4", "e7g5"]);
        expect(proof.effect).toBe("kept-material");
        expect(proof.otherLineUci).toBeUndefined();
        expect(nominateUnsearchedQuietReply(input.fen, input.candidates[0], input.replyProbes[0].lines, input.history))
            .toMatchObject({ reply: "e7g5" });
    });

    it("needs the opened route and a score contrast in the independent frame", () => {
        const { input, probe, lowBudgetAnswers } = fixture.bishopAttack;
        const question = nominateQuietReply(input.fen, input.candidates[0], probe.replies, input.history)!;
        const proof = confirmQuietReply(question, probe.answers, input.history)!;
        expect(proof.lineUci.slice(0, 3)).toEqual(["f4g5", "f7f6", "b3g8"]);
        expect(proof.otherLineUci?.slice(0, 3)).toEqual(["f4g5", "f7f6", "g5f4"]);
        expect(proof.explanation).toMatch(/from f7 also makes Bg8\+ legal/);
        expect(confirmQuietReply(question, lowBudgetAnswers, input.history)).toBeNull();
        expect(confirmQuietReply(question, probe.answers.slice(0, 1), input.history)).toBeNull();
    });

    it("rejects a different board, scope, game history, or unstable score", () => {
        const { input, probe } = fixture.heldout;
        const question = nominateQuietReply(input.fen, input.candidates[0], probe.replies, input.history)!;
        expect(confirmQuietReply(question, fixture.pawnAttack.probe.answers, input.history)).toBeNull();
        expect(confirmQuietReply(question, probe.answers, fixture.pawnAttack.input.history)).toBeNull();
        expect(nominateQuietReply(input.fen, input.candidates[0],
            [probe.replies[0], { ...probe.replies[1], cp: probe.replies[0].cp }], input.history)).toBeNull();
        const wrong = assessChessDecision({ ...input, quietReply: { ...probe, rootMoveUci: "a2a3" } });
        expect(wrong?.position.quietReply).toBeUndefined();
        expect(wrong?.moves.every(move => !move.quietReply)).toBe(true);
    });
});
