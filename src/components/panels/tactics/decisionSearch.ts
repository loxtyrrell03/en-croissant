import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import type { Role } from "chessops/types";
import { events, type BestMoves, type BestMovesPayload } from "@/bindings";
import { getBestMoves, killEngine, type LocalEngine } from "@/utils/engines";
import { buildTacticalEngineOptions } from "@/utils/tacticalMotifs/liveTactics";
import {
    measurePositionDecision,
    type DecisionEngineLine,
} from "@/utils/tacticalMotifs/decisionEvidence";
import {
    canStartDecisionSearch,
    validateDecisionSearchFrame,
} from "@/utils/tacticalMotifs/decisionSearchFrame";
import type {
    DecisionAssessmentInput,
    DecisionReplyProbe,
} from "@/utils/tacticalMotifs/decisionAssessment";
import type { TacticalGameHistory } from "@/utils/tacticalMotifs/gameHistory";
import type {
    CheckingDefenceRequest,
    CheckingDefenceProbe,
    DecisionCheckpoint,
    PassedAdvanceRequest,
} from "@/utils/tacticalMotifs/decisionCheckingDefence";
import { findAllowedImmediateMate } from "@/utils/tacticalMotifs/decisionMateConsequence";
import { findAllowedMateInTwo } from "@/utils/tacticalMotifs/decisionAllowedMateInTwo";
import { findAllowedMateInThree } from "@/utils/tacticalMotifs/decisionAllowedMateInThree";
import {
    nominatePasserFlight,
    selectPasserFlightCheck,
    type PasserFlightProbe,
} from "@/utils/tacticalMotifs/decisionPasserFlight";
import {
    compareExtraPositionMove,
    nominatePositionRefutation,
    pickExtraPositionMove,
    type ExtraPositionChoice,
} from "@/utils/tacticalMotifs/decisionPositionContrast";
import {
    nominateSharedReply,
    type DecisionSharedReplyProbe,
} from "@/utils/tacticalMotifs/decisionSharedReply";
import { nominateSharedRay } from "@/utils/tacticalMotifs/decisionSharedRay";
import {
    nominateSiblingRefutation,
    type SiblingRefutationFrames,
} from "@/utils/tacticalMotifs/decisionSiblingRefutation";
import {
    compareCheckToCapture,
    findCheckingOrderChoice,
    nominateCheckingOrder,
    type CheckingOrderProbe,
} from "@/utils/tacticalMotifs/decisionCheckingOrder";
import {
    confirmQuietReply,
    nominateQuietReply,
    nominateUnsearchedQuietReply,
    type QuietReplyProbe,
} from "@/utils/tacticalMotifs/quietReplyEvidence";
import {
    availableCaptureOrders,
    confirmCaptureOrder,
    type CaptureOrderProbe,
} from "@/utils/tacticalMotifs/captureOrderEvidence";

export type DecisionSearchTarget = {
    fen: string;
    playedMoveUci?: string;
    history?: TacticalGameHistory;
};

function searchDecisionCheckpoint(
    engine: LocalEngine,
    checkpoint: DecisionCheckpoint,
    signal: AbortSignal,
    deadline: number,
    history?: TacticalGameHistory,
    restricted?: string[],
    nodes = 2_400_000,
    width = 3,
) {
    return searchPosition(
        engine,
        checkpoint.fen,
        nodes,
        signal,
        Math.min(deadline, Date.now() + 3_600),
        history ? { fen: history.fen, moves: [...history.moves, ...checkpoint.prefix] } : undefined,
        restricted,
        width,
    );
}

export async function gatherCheckingDefence(
    engine: LocalEngine, target: DecisionSearchTarget, request: CheckingDefenceRequest,
    signal: AbortSignal, deadline: number,
): Promise<CheckingDefenceProbe | null> {
    const [capture] = await searchDecisionCheckpoint(
        engine, request.better, signal, deadline, target.history, request.captures,
    );
    if (!capture || capture.depth < 16 || !request.captures.includes(capture.pvUci[0])) return null;
    const [played] = await searchDecisionCheckpoint(
        engine, request.played, signal, deadline, target.history,
    );
    return played && played.depth >= 16 ? { capture, played } : null;
}

export async function gatherPassedAdvance(
    engine: LocalEngine, target: DecisionSearchTarget, request: PassedAdvanceRequest,
    signal: AbortSignal, deadline: number,
) {
    const lines: DecisionEngineLine[] = [];
    for (const checkpoint of request.checks) {
        const [line] = await searchDecisionCheckpoint(engine, checkpoint, signal, deadline, target.history);
        if (!line || line.depth < 16) return [];
        lines.push(line);
    }
    return lines;
}
const ROOT_BUDGETS = [600_000, 2_400_000, 9_600_000];
const REPLY_BUDGETS = [1_000_000, 4_000_000];
export const DECISION_SEARCH_SESSION_MS = 28_000;
const PREPARED_CHECKPOINT_NODES = 1_400_000;
const LATE_START_MS = 35_000;
const PIECE_VALUE: Record<Role, number> = {
    pawn: 100,
    knight: 320,
    bishop: 330,
    rook: 500,
    queen: 900,
    king: 20000,
};

export async function gatherCaptureOrder(
    engine: LocalEngine,
    target: DecisionSearchTarget,
    input: DecisionAssessmentInput,
    allowed: ReadonlySet<string>,
    signal: AbortSignal,
    deadline: number,
    progress: (phase: string) => void,
): Promise<CaptureOrderProbe | undefined> {
    const [proposal] = availableCaptureOrders(input, allowed);
    if (!proposal || Date.now() >= deadline) return;
    const { root, reply, checkpoint, remove, take } = proposal;
    progress("Comparing the two capture orders…");
    try {
        const lines = await searchDecisionCheckpoint(
            engine, { fen: checkpoint, prefix: [root.uci, reply.uci] },
            signal, deadline, target.history, [remove.uci, take.uci], 1_400_000, 2,
        );
        if (confirmCaptureOrder(proposal, lines, target.history)) {
            return { moveUci: root.uci, replyUci: reply.uci, lines };
        }
    } catch {
        signal.throwIfAborted();
    }
}

export async function gatherQuietReply(
    engine: LocalEngine,
    target: DecisionSearchTarget,
    input: DecisionAssessmentInput,
    movesWithoutProof: ReadonlySet<string>,
    signal: AbortSignal,
    deadline: number,
    progress: (phase: string) => void,
): Promise<QuietReplyProbe | undefined> {
    const leader = input.candidates[0];
    if (leader?.cp == null) return;
    const choices = input.candidates.flatMap(root => {
        const move = root.pvUci[0];
        if (!movesWithoutProof.has(move) || root.cp == null || root.depth !== leader.depth ||
            leader.cp! - root.cp > 50) return [];
        const probe = input.replyProbes?.find(probe => probe.moveUci === move);
        return probe ? [{ root, replies: probe.lines }] : [];
    });
    let request = choices.map(({ root, replies }) => ({
        proposal: nominateQuietReply(target.fen, root, replies, target.history), replies,
    })).find(({ proposal }) => proposal);
    const stopAt = Math.min(deadline, Date.now() + 4_800);
    try {
        if (!request) {
            for (const { root, replies } of choices) {
                const extra = nominateUnsearchedQuietReply(target.fen, root, replies, target.history);
                if (!extra) continue;
                progress("Checking another defensive reply…");
                const matched = await searchDecisionCheckpoint(
                    engine, { fen: extra.fen, prefix: [extra.root] }, signal, stopAt,
                    target.history, [extra.safer, extra.reply], 1_400_000, 2,
                );
                const proposal = nominateQuietReply(target.fen, root, matched, target.history);
                if (!proposal || proposal.reply.uci !== extra.reply) return;
                request = { proposal, replies: matched };
                break;
            }
        }
        if (!request?.proposal || Date.now() >= stopAt) return;
        const { proposal } = request;
        progress("Checking the tactical answer…");
        const answers = await searchDecisionCheckpoint(
            engine, { fen: proposal.checkpoint, prefix: [proposal.root.uci, proposal.reply.uci] },
            signal, stopAt, target.history, undefined, 1_400_000, 3,
        );
        if (!confirmQuietReply(proposal, answers, target.history)) return;
        return { rootMoveUci: proposal.root.uci, replies: request.replies, answers };
    } catch {
        signal.throwIfAborted();
        return;
    }
}

function board(fen: string) {
    return parseFen(fen)
        .chain((value) => Chess.fromSetup(value))
        .unwrap();
}

function afterMove(fen: string, uci: string) {
    const position = board(fen);
    const move = parseUci(uci);
    if (!move || !position.isLegal(move))
        throw new Error("The selected move is no longer legal on this board.");
    position.play(move);
    return makeFen(position.toSetup());
}

export function decisionCaptureChoices(fen: string, rootUci: string) {
    const root = parseUci(rootUci);
    if (!root || !("from" in root)) return [];
    const position = board(afterMove(fen, rootUci));
    const offered = position.board.get(root.to);
    if (!offered || offered.role === "king" || offered.color === position.turn) return [];
    const choices: Array<{ uci: string; value: number }> = [];
    for (const [from, targets] of position.allDests()) {
        const attacker = position.board.get(from)!;
        for (const to of targets) {
            const enPassant =
                attacker.role === "pawn" && position.epSquare === to && !position.board.has(to);
            const victim = enPassant ? to + (position.turn === "white" ? -8 : 8) : to;
            if (victim !== root.to) continue;
            const promotions =
                attacker.role === "pawn" && (to < 8 || to >= 56)
                    ? (["queen", "rook", "bishop", "knight"] as const)
                    : [undefined];
            for (const promotion of promotions) {
                const move = { from, to, promotion };
                if (!position.isLegal(move)) continue;
                const reached = position.clone();
                reached.play(move);
                if (
                    PIECE_VALUE[attacker.role] > PIECE_VALUE[offered.role] &&
                    [...reached.allDests()].some(([, squares]) => squares.has(to))
                )
                    continue;
                choices.push({ uci: makeUci(move), value: PIECE_VALUE[attacker.role] });
            }
        }
    }
    return choices
        .sort((a, b) => a.value - b.value || a.uci.localeCompare(b.uci))
        .slice(0, 3)
        .map((item) => item.uci);
}

function scoreForMover(fen: string, line: BestMoves): DecisionEngineLine {
    const sign = fen.split(" ")[1] === "w" ? 1 : -1;
    return {
        fen,
        depth: line.depth,
        pvUci: line.uciMoves,
        cp: line.score.value.type === "cp" ? sign * line.score.value.value : null,
        mate: line.score.value.type === "mate" ? sign * line.score.value.value : null,
    };
}

async function searchPosition(
    engine: LocalEngine,
    fen: string,
    nodes: number,
    signal: AbortSignal,
    stopAt: number,
    history?: TacticalGameHistory,
    restricted?: string[],
    width = 3,
): Promise<DecisionEngineLine[]> {
    signal.throwIfAborted();
    const position = board(fen);
    if (position.isEnd() || Date.now() >= stopAt || !canStartDecisionSearch(fen, history))
        return [];
    const destinations = position.allDests();
    const legal = [...destinations.values()].reduce((total, set) => total + set.size(), 0);
    // A single promotion square represents four possible moves.
    const additionalPromotions = [...destinations].reduce(
        (total, [from, dests]) =>
            total +
            (position.board.get(from)?.role === "pawn"
                ? [...dests].filter((to) => to < 8 || to >= 56).length * 3
                : 0),
        0,
    );
    const ranks = Math.min(width, restricted?.length ?? legal + additionalPromotions);
    const tab = `decision-evidence:${crypto.randomUUID()}`;
    const origin = history?.fen ?? fen;
    const moves = history?.moves ?? [];
    const engineOptions = buildTacticalEngineOptions(engine.settings, ranks).filter((option) => {
        const name = option.name.trim().toLowerCase();
        return !["threads", "hash", "skill level", "uci_limitstrength", "uci_elo"].includes(name);
    });
    engineOptions.push({ name: "Threads", value: "1" }, { name: "Hash", value: "64" });

    return new Promise((resolve, reject) => {
        let unlisten: (() => void) | undefined;
        let requested = false;
        let registered = false;
        let settled = false;
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        const release = () => {
            void killEngine(engine, tab).catch(() => {});
        };
        const detach = () => {
            clearTimeout(cleanupTimer);
            unlisten?.();
            unlisten = undefined;
        };
        const finish = (lines: DecisionEngineLine[], error?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            if (requested) release();
            if (!requested || registered) detach();
            else
                cleanupTimer = setTimeout(() => {
                    release();
                    detach();
                }, LATE_START_MS);
            if (error) reject(error);
            else resolve(lines);
        };
        const abort = () =>
            finish([], signal.reason ?? new DOMException("Analysis cancelled", "AbortError"));
        const timer = setTimeout(() => finish([]), Math.max(1, stopAt - Date.now()));
        const accept = (
            payload: Omit<BestMovesPayload, "bestLines"> & { bestLines: BestMoves[] },
        ) => {
            if (
                payload.tab !== tab ||
                payload.engine !== engine.id ||
                payload.fen !== origin ||
                JSON.stringify(payload.moves) !== JSON.stringify(moves) ||
                JSON.stringify(payload.searchMoves ?? []) !== JSON.stringify(restricted ?? [])
            )
                return;
            registered = true;
            if (settled) {
                release();
                detach();
                return;
            }
            if (payload.progress < 100) return;
            const lines = [...payload.bestLines].sort((a, b) => a.multipv - b.multipv);
            if (
                lines.length !== ranks ||
                lines.some(
                    (line, index) =>
                        line.source ||
                        line.multipv !== index + 1 ||
                        line.depth !== lines[0].depth ||
                        (line.score.value.type !== "cp" && line.score.value.type !== "mate"),
                )
            )
                return;
            const candidates = validateDecisionSearchFrame(
                fen,
                lines.map((line) => scoreForMover(fen, line)),
                history,
            );
            if (!candidates) return;
            if (restricted) {
                const expected = new Set(restricted.map((uci) => afterMove(fen, uci)));
                if (
                    candidates.some(
                        (line) =>
                            !line.pvUci.length || !expected.has(afterMove(fen, line.pvUci[0])),
                    )
                )
                    return;
            }
            finish(candidates);
        };
        signal.addEventListener("abort", abort, { once: true });
        void events.bestMovesPayload
            .listen(({ payload }) => {
                try {
                    accept(payload);
                } catch (error) {
                    finish([], error);
                }
            })
            .then((dispose) => {
                if (settled) {
                    dispose();
                    return;
                }
                unlisten = dispose;
                requested = true;
                return getBestMoves(
                    engine,
                    tab,
                    { t: "Nodes", c: nodes },
                    {
                        fen: origin,
                        moves,
                        extraOptions: engineOptions,
                        searchMoves: restricted,
                    },
                )
                    .then((result) => {
                        if (result)
                            accept({
                                bestLines: result[1],
                                progress: result[0],
                                tab,
                                engine: engine.id,
                                fen: origin,
                                moves,
                                searchMoves: restricted,
                            });
                    })
                    .finally(() => {
                        if (settled) detach();
                    });
            })
            .catch((error) => finish([], error));
    });
}

export async function gatherSiblingRefutation(
    engine: LocalEngine,
    target: DecisionSearchTarget,
    input: DecisionAssessmentInput,
    signal: AbortSignal,
    deadline: number,
    progress: (phase: string) => void,
): Promise<SiblingRefutationFrames | undefined> {
    signal.throwIfAborted();
    if (Date.now() >= deadline) return;
    const choice = nominateSiblingRefutation(target.fen, input.candidates);
    if (!choice) return;
    progress("Checking the tactical reply to a candidate…");
    const stopAt = Math.min(deadline, Date.now() + 3_600);
    const query = (fen: string, root: string, restricted?: string[]) =>
        searchDecisionCheckpoint(
            engine, { fen, prefix: [root] }, signal, stopAt, target.history,
            restricted, 1_400_000, restricted ? 1 : 3,
        );
    try {
        const alternatives = [
            input.positionReply,
            ...(input.replyProbes ?? []),
        ].find((probe) => probe?.moveUci === choice.weakStep.uci)?.lines ?? [];
        const reply = alternatives[0] ??
            (await query(choice.replyFen, choice.weakStep.uci))[0];
        if (
            !reply || reply.depth < 16 || reply.cp === null || reply.mate != null ||
            reply.pvUci[0] !== choice.replyUci || Math.abs(reply.cp + choice.weak.cp!) > 90
        ) return;
        if (!choice.controlFen) return { reply };
        const matching = input.replyProbes?.find(({ moveUci }) => moveUci === choice.safeStep.uci);
        const cached = matching?.lines.find((line) =>
            line.depth >= 16 && line.pvUci[0] === choice.replyUci,
        );
        const control = cached ??
            (await query(choice.controlFen, choice.safeStep.uci, [choice.replyUci]))[0];
        return control ? { reply, control } : undefined;
    } catch {
        signal.throwIfAborted();
        return;
    }
}

export async function gatherCheckingOrder(
    engine: LocalEngine,
    target: DecisionSearchTarget,
    input: DecisionAssessmentInput,
    scopes: { mistake: boolean; position: boolean },
    signal: AbortSignal,
    deadline: number,
    progress: (phase: string) => void,
): Promise<CheckingOrderProbe | undefined> {
    signal.throwIfAborted();
    if (Date.now() >= deadline) return;
    const pair = input.comparisonCandidates ?? input.candidates;
    const played = pair.find((line) => line.pvUci[0] === target.playedMoveUci);
    const mistake = scopes.mistake &&
        pair[0]?.pvUci[0] === input.candidates[0]?.pvUci[0] && played
        ? nominateCheckingOrder(target.fen, pair[0], played)
        : null;
    const request = mistake ?? (scopes.position && findCheckingOrderChoice(target.fen, input.candidates));
    if (!request) return;
    const scope = mistake ? "mistake" : "position";
    const repliesFor = (move: string) => [input.positionReply, ...(input.replyProbes ?? [])]
        .find((probe) => probe?.moveUci === move)?.lines ?? [];
    const matching = request.moves.map((uci) =>
        repliesFor(request.choice.uci).find((line) => line.pvUci[0] === uci),
    );
    const [check, take] = matching;
    const stopAt = Math.min(deadline, Date.now() + 3_600);
    try {
        let lines = check && take && check.depth === take.depth && check.depth >= 16
            ? [check, take] : [];
        if (!lines.length) {
            progress("Comparing the check with taking immediately…");
            lines = await searchDecisionCheckpoint(
                engine, { fen: request.fen, prefix: [request.choice.uci] }, signal, stopAt,
                target.history, request.moves, 1_400_000, 2,
            );
        }
        if (lines.length !== 2) return;
        if (request.betterDefence.kind !== "same-reply") return { scope, lines };
        if (!compareCheckToCapture(request, lines, target.history)) return;
        const reply = request.firstReply.uci;
        const cached = repliesFor(request.preferred.uci).find((line) =>
            line.pvUci[0] === reply && line.depth >= 16,
        );
        if (cached) return { scope, lines, control: cached };
        progress("Checking the same reply after the stronger move…");
        const [control] = await searchDecisionCheckpoint(
            engine, { fen: request.betterDefence.fen, prefix: [request.preferred.uci] },
            signal, stopAt, target.history, [reply], 1_000_000, 1,
        );
        return control ? { scope, lines, control } : undefined;
    } catch {
        signal.throwIfAborted();
        return;
    }
}

export async function gatherExtraPositionChoice(
    engine: LocalEngine,
    target: DecisionSearchTarget,
    candidates: DecisionEngineLine[],
    signal: AbortSignal,
    deadline: number,
): Promise<ExtraPositionChoice | undefined> {
    signal.throwIfAborted();
    const { fen, history } = target;
    const best = candidates[0];
    if (
        !best ||
        best.depth < 18 ||
        best.cp === null ||
        Date.now() >= deadline ||
        (measurePositionDecision(fen, candidates)?.legalMoves ?? 0) <= candidates.length
    )
        return;
    try {
        const shortlist = await searchPosition(
            engine,
            fen,
            90_000,
            signal,
            Math.min(deadline, Date.now() + 2_000),
            history,
            undefined,
            6,
        );
        const move = pickExtraPositionMove(fen, candidates, shortlist);
        if (!move) return;
        const pair = await searchPosition(
            engine,
            fen,
            1_200_000,
            signal,
            Math.min(deadline, Date.now() + 4_000),
            history,
            [best.pvUci[0], move],
        );
        const contrast = compareExtraPositionMove(fen, best, move, pair);
        if (!contrast) return;
        const replies = await searchPosition(
            engine,
            contrast.fen,
            1_000_000,
            signal,
            Math.min(deadline, Date.now() + 3_000),
            history ? { fen: history.fen, moves: [...history.moves, move] } : undefined,
        );
        return replies.length ? { shortlist, pair, replies } : undefined;
    } catch {
        signal.throwIfAborted();
        return;
    }
}

export async function gatherPreparedCheckpoint(
    engine: LocalEngine,
    target: DecisionSearchTarget,
    request: { fen: string; prefix: string[] },
    signal: AbortSignal,
    deadline: number,
) {
    return searchPosition(
        engine,
        request.fen,
        PREPARED_CHECKPOINT_NODES,
        signal,
        Math.min(deadline, Date.now() + 3_000),
        target.history
            ? { fen: target.history.fen, moves: [...target.history.moves, ...request.prefix] }
            : undefined,
    ).catch(() => {
        signal.throwIfAborted();
        return [];
    });
}

export async function gatherDecisionEvidence(
    engine: LocalEngine,
    target: DecisionSearchTarget,
    signal: AbortSignal,
    progress: (phase: string) => void,
    sessionEnd = Date.now() + DECISION_SEARCH_SESSION_MS,
): Promise<DecisionAssessmentInput> {
    const { fen, playedMoveUci, history } = target;
    let candidates: DecisionEngineLine[] = [];
    let rootNodes = ROOT_BUDGETS[0];
    progress("Comparing candidate moves…");
    for (const nodes of ROOT_BUDGETS) {
        const lines = await searchPosition(
            engine,
            fen,
            nodes,
            signal,
            Math.min(Date.now() + (candidates.length ? 8_000 : 12_000), sessionEnd),
            history,
        );
        if (!lines.length) break;
        candidates = lines;
        rootNodes = nodes;
        if (lines[0].depth >= 18 || lines[0].mate !== null) break;
    }
    if (!candidates.length)
        throw new Error(
            "The engine did not return a complete, legal search. Try again from this position.",
        );
    const best = candidates[0];
    const sameBest =
        playedMoveUci && afterMove(fen, playedMoveUci) === afterMove(fen, best.pvUci[0]);
    // A verified short mate needs no scored played line. The worker
    // replays the same proof, while the usual search of the best reply continues.
    const shortMate =
        !sameBest &&
        (findAllowedImmediateMate(fen, best, playedMoveUci, history) ??
            findAllowedMateInTwo(fen, best, playedMoveUci, history));
    let comparison: DecisionEngineLine[] | undefined;
    if (playedMoveUci && !sameBest && !shortMate) {
        progress("Checking the move played…");
        comparison = await searchPosition(
            engine,
            fen,
            rootNodes,
            signal,
            Math.min(sessionEnd, Date.now() + 6_000),
            history,
            [best.pvUci[0], playedMoveUci],
        );
    }
    progress("Checking defensive replies…");
    const replyProbes: DecisionReplyProbe[] = [];
    // A paired search can reverse the ranking. Search the actual played
    // move's replies by board identity rather than assuming it ranked second.
    const played =
        playedMoveUci && !sameBest
            ? comparison?.find(
                  (line) => afterMove(fen, line.pvUci[0]) === afterMove(fen, playedMoveUci),
              )
            : undefined;
    const provedMateInThree =
        played && (played.mate ?? 0) <= -3 && comparison
            ? findAllowedMateInThree(fen, best, playedMoveUci, comparison, [], history)
            : null;
    for (const root of played && !provedMateInThree ? [played, best] : [best]) {
        const moveUci = root.pvUci[0];
        const nextFen = afterMove(fen, moveUci);
        const nextHistory = history
            ? { fen: history.fen, moves: [...history.moves, moveUci] }
            : undefined;
        let lines: DecisionEngineLine[] = [];
        for (const nodes of REPLY_BUDGETS) {
            const found = await searchPosition(
                engine,
                nextFen,
                nodes,
                signal,
                Math.min(sessionEnd, Date.now() + 5_000),
                nextHistory,
            );
            if (!found.length) break;
            lines = found;
            if (
                found[0].depth >= 16 &&
                ((root.cp !== null &&
                    found[0].cp !== null &&
                    Math.abs(root.cp + found[0].cp) <= 90) ||
                    (root.mate != null && found[0].mate != null && root.mate * found[0].mate < 0))
            )
                break;
        }
        if (!lines.length) continue;
        const probe: DecisionReplyProbe = { moveUci, lines, targetedCaptures: [] };
        if (
            root === best &&
            lines[0].depth >= 16 &&
            best.cp !== null &&
            lines[0].cp !== null &&
            Math.abs(best.cp + lines[0].cp) <= 90
        ) {
            for (const capture of decisionCaptureChoices(fen, moveUci)) {
                const existing = lines.find((line) => line.pvUci[0] === capture);
                const selected =
                    existing ??
                    (
                        await searchPosition(
                            engine,
                            nextFen,
                            1_000_000,
                            signal,
                            Math.min(sessionEnd, Date.now() + 3_000),
                            nextHistory,
                            [capture],
                        )
                    )[0];
                if (selected) probe.targetedCaptures!.push({ line: selected });
            }
        }
        replyProbes.push(probe);
    }
    let sharedReply: DecisionSharedReplyProbe | undefined;
    const pairedBest = comparison?.[0];
    const opponent =
        played && replyProbes.find((probe) => probe.moveUci === played.pvUci[0])?.lines[0];
    if (played && opponent && pairedBest?.pvUci[0] === best.pvUci[0]) {
        const request = nominateSharedReply(fen, pairedBest, played, opponent)
            ?? nominateSharedRay(fen, pairedBest, played, opponent);
        if (request) {
            const cached = replyProbes
                .find((probe) => probe.moveUci === request.betterMoveUci)
                ?.lines.find((line) => line.depth >= 16 && line.pvUci[0] === request.replyUci);
            const lines = cached
                ? [cached]
                : await searchPosition(
                      engine,
                      request.fen,
                      1_000_000,
                      signal,
                      Math.min(sessionEnd, Date.now() + 3_000),
                      history
                          ? { fen: history.fen, moves: [...history.moves, request.betterMoveUci] }
                          : undefined,
                      [request.replyUci],
                  ).catch(() => {
                      signal.throwIfAborted();
                      return [];
                  });
            if (lines[0])
                sharedReply = {
                    betterMoveUci: request.betterMoveUci,
                    playedMoveUci: request.playedMoveUci,
                    line: lines[0],
                };
        }
    }
    let positionReply: DecisionReplyProbe | undefined;
    const alternative = nominatePositionRefutation(fen, candidates);
    if (alternative && !replyProbes.some((probe) => probe.moveUci === alternative.moveUci)) {
        const lines = await searchPosition(
            engine,
            alternative.fen,
            1_000_000,
            signal,
            Math.min(sessionEnd, Date.now() + 3_000),
            history
                ? { fen: history.fen, moves: [...history.moves, alternative.moveUci] }
                : undefined,
        ).catch(() => {
            signal.throwIfAborted();
            return [];
        });
        if (lines.length) positionReply = { moveUci: alternative.moveUci, lines };
    }
    let passerFlight: PasserFlightProbe | undefined;
    if (played && pairedBest?.pvUci[0] === best.pvUci[0] && played !== pairedBest) {
        const replies = replyProbes.find((probe) => probe.moveUci === played.pvUci[0])?.lines ?? [];
        const request = nominatePasserFlight(fen, pairedBest, played, replies, history);
        if (request && Date.now() < sessionEnd) {
            progress("Checking the passed-pawn defence…");
            const stopAt = Math.min(sessionEnd, Date.now() + 3_000);
            const query = (checkpoint: DecisionCheckpoint, restricted?: string[]) =>
                searchDecisionCheckpoint(
                    engine,
                    checkpoint,
                    signal,
                    stopAt,
                    history,
                    restricted,
                    500_000,
                    2,
                ).catch(() => {
                    signal.throwIfAborted();
                    return [];
                });
            const stronger = await query(request.better);
            const check = selectPasserFlightCheck(request, stronger);
            if (check) {
                const [counter] = await query(request.played, [check.pvUci[0]]);
                if (counter) passerFlight = { better: stronger, played: counter };
            }
        }
    }
    signal.throwIfAborted();
    return {
        fen,
        candidates,
        playedMoveUci,
        comparisonCandidates: comparison,
        replyProbes,
        positionReply,
        sharedReply,
        passerFlight,
    };
}
