import { makeFen } from "chessops/fen";
import { Chess } from "chessops/chess";
import { pawnAttacks, rookAttacks } from "chessops/attacks";
import type { Color, Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "@/utils/tacticalMotifs/causalTactics";
import {
    measureDecisionLine,
    type DecisionEngineLine,
} from "@/utils/tacticalMotifs/decisionEvidence";
import type { PositionStrategicPlan } from "@/utils/tacticalMotifs/decisionPositionPlans";
import { tacticalRepetitionKey } from "@/utils/tacticalMotifs/repetitionHistory";

type Episode = {
    start: number;
    through: number;
    contact: Square;
    file: number;
    owner: Color;
    rookUse: number | null;
};

const file = (square: Square) => square % 8;
const fileName = (column: number) => "abcdefgh"[column];
const pawnsOnFile = (pos: Chess, owner: Color, column: number) =>
    [...pos.board.pawn.intersect(pos.board[owner])].some((square) => file(square) === column);

function fileUse(
    steps: TacticalReplayStep[],
    from: number,
    through: number,
    owner: Color,
    column: number,
    allowPawnRecovery: boolean,
) {
    const exchangeSquare = steps[from - 1].move.to;
    const survivor = steps[from - 1].after.board.get(exchangeSquare);
    let tracksSurvivor = survivor?.color === opposite(owner) && survivor.role === "pawn";
    for (let index = from; index <= through; index++) {
        const step = steps[index];
        const { move, before, after } = step;
        if (pawnsOnFile(after, owner, column)) break;
        if (
            before.turn !== owner ||
            after.isCheck() ||
            before.board.get(move.from)?.role !== "rook" ||
            file(move.to) !== column
        ) {
            if (move.from === exchangeSquare || move.to === exchangeSquare) tracksSurvivor = false;
            continue;
        }
        if (step.capture) {
            if (
                allowPawnRecovery &&
                tracksSurvivor &&
                file(move.from) === column &&
                move.to === exchangeSquare
            )
                return index;
        } else {
            const ray = rookAttacks(move.to, after.board.occupied);
            const access = [...ray.diff(after.board[owner])].filter(
                (square) =>
                    file(square) === column && (owner === "white" ? square >= 32 : square < 32),
            );
            if (access.length >= 2) return index;
        }
        if (move.from === exchangeSquare || move.to === exchangeSquare) tracksSurvivor = false;
    }
    return null;
}

function settledExchange(steps: TacticalReplayStep[], at: number, delayed: boolean) {
    const { to } = steps[at].move;
    let end = at;
    if (delayed) {
        for (let i = at + 1; i <= at + 4 && i < steps.length; i++) {
            const { move, capture } = steps[i];
            if (move.to === to && capture) {
                end = i;
                break;
            }
            if (move.from === to || move.to === to || move.promotion || capture) break;
        }
    }
    while (steps[end + 1]?.capture && steps[end + 1].move.to === to) end++;
    return end;
}

function observe(steps: TacticalReplayStep[], delayed: boolean) {
    const side = steps[0].before.turn;
    const contacts: Episode[] = [];
    for (const [index, push] of steps.slice(0, 5).entries()) {
        const { move, before, after } = push;
        if (
            before.turn !== side ||
            push.capture ||
            before.isCheck() ||
            after.isCheck() ||
            move.promotion ||
            before.board.get(move.from)?.role !== "pawn"
        )
            continue;
        const contactsAfter = pawnAttacks(side, move.to)
            .intersect(after.board.pawn)
            .intersect(after.board[opposite(side)]);
        for (const target of contactsAfter) {
            for (let taken = index + 1; taken <= index + 4 && taken < steps.length; taken++) {
                const take = steps[taken];
                const { from, to } = take.move;
                if (from !== target && from !== move.to && to !== target && to !== move.to)
                    continue;
                if (
                    !take.capture ||
                    !((from === target && to === move.to) || (from === move.to && to === target)) ||
                    take.before.board.get(to)?.role !== "pawn" ||
                    take.before.board.get(from)?.role !== "pawn"
                )
                    break;
                const end = settledExchange(steps, taken, delayed);
                const through = end + 2;
                if (end === taken || through >= steps.length || steps[through].after.isCheck())
                    break;
                const tail = steps.slice(end, through + 1);
                if (
                    Math.abs(tail[0].balance) > 100 ||
                    tail.some(({ balance }) => balance !== tail[0].balance)
                )
                    break;
                for (const column of [file(move.to), file(target)]) {
                    for (const owner of [side, opposite(side)]) {
                        if (
                            !pawnsOnFile(before, owner, column) ||
                            tail.some(({ after }) => pawnsOnFile(after, owner, column))
                        )
                            continue;
                        const linked = steps
                            .slice(taken, end + 1)
                            .some(
                                (played) =>
                                    (played.before.turn === owner &&
                                        file(played.move.from) === column &&
                                        played.before.board.get(played.move.from)?.role ===
                                            "pawn") ||
                                    (played.before.turn !== owner &&
                                        file(played.move.to) === column &&
                                        played.before.board.get(played.move.to)?.role === "pawn"),
                            );
                        if (!linked) continue;
                        contacts.push({
                            start: index,
                            through,
                            contact: target,
                            file: column,
                            owner,
                            rookUse: fileUse(
                                steps,
                                end + 1,
                                Math.min(end + 5, steps.length - 1),
                                owner,
                                column,
                                delayed,
                            ),
                        });
                    }
                }
                break;
            }
        }
    }
    return contacts;
}

function describe(steps: TacticalReplayStep[], event: Episode) {
    const first = steps[0].san;
    const push = steps[event.start].san;
    const owner = event.owner === "white" ? "White" : "Black";
    const prefix = event.start ? `After ${first}, ${push}` : push;
    return `${prefix} challenges the pawn on ${makeSquare(event.contact)}. The exchange leaves ${owner} without a pawn on the ${fileName(event.file)}-file${event.rookUse === null ? "" : `, which ${owner} uses with ${steps[event.rookUse].san}`}.`;
}

function extended(event: Episode) {
    return Math.max(event.through, event.rookUse ?? 0);
}

export function findRepeatedBreak(
    fen: string,
    choice: DecisionEngineLine,
    reply?: DecisionEngineLine,
    delayed = false,
) {
    if (
        choice.cp === null ||
        choice.mate != null ||
        choice.depth < 16 ||
        !reply ||
        reply.cp === null ||
        reply.mate != null ||
        reply.depth < 16 ||
        Math.abs(choice.cp + reply.cp) > 75
    )
        return null;
    const [root] = replayTacticalLine(fen, choice.pvUci.slice(0, 1));
    if (
        !root ||
        measureDecisionLine(makeFen(root.after.toSetup()), reply)?.drawnEnding !== false ||
        measureDecisionLine(fen, choice)?.drawnEnding !== false
    )
        return null;
    const paired = replayTacticalLine(fen, choice.pvUci.slice(0, 14));
    const expanded = replayTacticalLine(fen, [root.uci, ...reply.pvUci.slice(0, 13)]);
    if (!paired.length || !expanded.length) return null;
    const same = (a: Episode, b: Episode) =>
        a.start === 0 &&
        b.start === 0 &&
        a.contact === b.contact &&
        a.file === b.file &&
        a.owner === b.owner &&
        a.owner === root.before.turn;
    const repeated = observe(expanded, delayed);
    const matches = observe(paired, delayed).flatMap((first) =>
        repeated
            .filter((other) => same(first, other))
            .map((other) => ({
                description: describe(paired, first),
                corroboration: describe(expanded, other),
                file: fileName(first.file),
                target: makeSquare(first.contact),
                linesUci: [
                    paired.slice(0, extended(first) + 1).map((step) => step.uci),
                    expanded.slice(0, extended(other) + 1).map((step) => step.uci),
                ] as [string[], string[]],
                rookInBoth: first.rookUse !== null && other.rookUse !== null,
                rookInOne: first.rookUse !== null || other.rookUse !== null,
            })),
    );
    return (delayed ? matches.find((match) => match.rookInBoth) : null) ?? matches[0] ?? null;
}

export function compareBreakPlans(
    fen: string,
    candidates: DecisionEngineLine[],
    requireRookUse: boolean,
    delayed = false,
) {
    const [leader, ...other] = candidates;
    if (!leader || leader.cp === null || leader.mate != null || leader.depth < 16) return null;
    const analyse = (line: DecisionEngineLine) => {
        const measured = measureDecisionLine(fen, line);
        if (!measured || measured.drawnEnding) return null;
        const steps = replayTacticalLine(fen, line.pvUci.slice(0, 14));
        return steps.length ? { steps, episodes: observe(steps, delayed) } : null;
    };
    const main = analyse(leader);
    if (!main?.episodes.length) return null;
    for (const candidate of other) {
        if (
            candidate.cp === null ||
            candidate.mate != null ||
            candidate.depth !== leader.depth ||
            leader.cp < candidate.cp ||
            leader.cp - candidate.cp > 60 ||
            leader.pvUci[0] === candidate.pvUci[0]
        )
            continue;
        const alternative = analyse(candidate);
        if (!alternative) continue;
        for (const first of main.episodes) {
            for (const second of alternative.episodes) {
                if (Math.min(first.start, second.start) !== 0) continue;
                const sameLever =
                    main.steps[first.start].uci === alternative.steps[second.start].uci &&
                    first.contact === second.contact;
                if ((first.owner !== second.owner || first.file !== second.file) === sameLever)
                    continue;
                if (
                    requireRookUse &&
                    (first.rookUse === null ||
                        second.rookUse === null ||
                        first.owner !== main.steps[0].before.turn ||
                        second.owner !== main.steps[0].before.turn)
                )
                    continue;
                const samePosition = new Set(
                    main.steps
                        .slice(0, first.start + 1)
                        .map(({ after }) => tacticalRepetitionKey(after)),
                );
                if (
                    alternative.steps
                        .slice(0, second.start + 1)
                        .some(({ after }) => samePosition.has(tacticalRepetitionKey(after)))
                )
                    continue;
                const through = [extended(first), extended(second)];
                return {
                    mode: sameLever ? "shared break" : "different breaks",
                    description: `${sameLever ? "Both choices prepare the same pawn break." : "The two leading choices change different pawn structures."} ${describe(main.steps, first)} ${describe(alternative.steps, second)}`,
                    linesUci: [
                        leader.pvUci.slice(0, through[0] + 1),
                        candidate.pvUci.slice(0, through[1] + 1),
                    ],
                } satisfies PositionStrategicPlan & { mode: string };
            }
        }
    }
    return null;
}
