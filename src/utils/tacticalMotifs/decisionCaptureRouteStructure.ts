import { pawnAttacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import type { Square } from "chessops/types";
import { makeSquare, opposite } from "chessops/util";
import { replayTacticalLine, type TacticalReplayStep } from "./causalTactics";
import type { DecisionReplyProbe } from "./decisionAssessment";
import { measureDecisionLine, measurePositionDecision, type DecisionEngineLine } from "./decisionEvidence";
import { followPieceIdentities, initialPieceIdentities } from "./decisionPieceIdentity";
import type { PositionStrategicPlan } from "./decisionPositionPlans";

const WINDOW = 6;
const MIN_PREFERENCE = 40;
const CLOSE_REPLY = 35;

function qualified(line: DecisionEngineLine | undefined): line is DecisionEngineLine & { cp: number } {
    return !!line && line.depth >= 16 && line.cp !== null && Number.isFinite(line.cp) &&
        line.mate == null && !line.lowerbound && !line.upperbound && !line.claimHistory;
}

function quietCheck(steps: TacticalReplayStep[]) {
    const step = steps[0];
    const piece = step?.before.board.get(step.move.from);
    return !!piece && piece.role !== "pawn" && piece.role !== "king" && !step.capture && step.after.isCheck();
}

function capturedOriginal(steps: TacticalReplayStep[]) {
    if (steps.length < 3) return;
    const taking = steps[2];
    const piece = taking.before.board.get(taking.move.from);
    if (!taking.capture || piece?.role === "pawn" || piece?.role === "king") return;
    const identities = initialPieceIdentities(steps[0].before);
    followPieceIdentities(identities, steps[0]);
    followPieceIdentities(identities, steps[1]);
    return followPieceIdentities(identities, taking);
}

function capturedSquare(step: TacticalReplayStep) {
    return step.before.epSquare === step.move.to && step.before.board.get(step.move.from)?.role === "pawn"
        ? step.move.to + (step.before.turn === "white" ? -8 : 8)
        : step.move.to;
}

function settled(steps: TacticalReplayStep[]) {
    let end = WINDOW;
    while (end < WINDOW + 2 && steps[end]?.capture && steps[end - 1].capture &&
        capturedSquare(steps[end]) === steps[end - 1].move.to) {
        end++;
    }
    return steps.slice(0, end);
}

type Link = { from: Square; to: Square };

function retains(steps: TacticalReplayStep[], link: Link) {
    const side = steps[0].before.turn;
    return steps.every(({ after }) => {
        const pawns = after.board.pieces(side, "pawn");
        return pawns.has(link.from) && pawns.has(link.to);
    });
}

/** Only consider a pawn capture already priced in the normal root shortlist. */
export function nominateCaptureRouteStructure(fen: string, candidates: DecisionEngineLine[]) {
    const [leading] = candidates;
    if (!qualified(leading)) return;
    const checking = replayTacticalLine(fen, leading.pvUci.slice(0, WINDOW + 2));
    if (checking.length < WINDOW || !quietCheck(checking)) return;
    const target = capturedOriginal(checking);
    if (target === undefined) return;
    const { before } = checking[0];
    const victim = before.board.get(target);
    if (!victim || victim.role === "pawn" || victim.role === "king") return;
    const pawns = before.board.pieces(before.turn, "pawn");
    for (const alternative of candidates.slice(1)) {
        if (!qualified(alternative) || alternative.depth !== leading.depth ||
            leading.cp - alternative.cp < MIN_PREFERENCE) continue;
        const [take] = replayTacticalLine(fen, alternative.pvUci.slice(0, 1));
        if (!take?.capture || take.move.promotion || take.move.to !== target || !pawns.has(take.move.from)) continue;
        const pawn = take.move.from;
        const links: Link[] = [
            ...[...pawnAttacks(before.turn, pawn).intersect(pawns)].map(to => ({ from: pawn, to })),
            ...[...pawnAttacks(opposite(before.turn), pawn).intersect(pawns)].map(from => ({ from, to: pawn })),
        ].filter(link => retains(settled(checking), link));
        if (links.length) return { leading, alternative, checking, take, target, victim, links };
    }
}

type Route = NonNullable<ReturnType<typeof nominateCaptureRouteStructure>>;

function replyAt(root: TacticalReplayStep, probe: DecisionReplyProbe | undefined, count: number) {
    const lines = probe?.lines.slice(0, count);
    const fen = makeFen(root.after.toSetup());
    if (probe?.moveUci !== root.uci || !lines || lines.length !== count ||
        lines.some(line => !qualified(line) || line.depth !== lines[0].depth)) return;
    if (count === 2 && ((lines[0].cp ?? 0) < (lines[1].cp ?? 0) ||
        measurePositionDecision(fen, lines)?.bestSecondGapCp == null)) return;
    if (lines.some(line => measureDecisionLine(fen, line)?.drawnEnding !== false)) return;
    return lines;
}

function checkingPaths(fen: string, route: Route, probe: DecisionReplyProbe | undefined) {
    const responses = replyAt(route.checking[0], probe, 2);
    const best = responses?.[0];
    if (!responses || !qualified(best) || Math.abs(best.cp + route.leading.cp) > 90) return;
    const replies = responses.filter(line => qualified(line) && best.cp - line.cp <= CLOSE_REPLY);
    const paths = [
        route.checking,
        ...replies.map(line => replayTacticalLine(fen, [route.leading.pvUci[0], ...line.pvUci.slice(0, WINDOW + 1)])),
    ];
    if (paths.some(steps => steps.length < WINDOW || capturedOriginal(steps) !== route.target)) return;
    const finished = paths.map(settled);
    const link = route.links.find(candidate => finished.every(path => retains(path, candidate)));
    return link ? { link, finished, best } : undefined;
}

export function captureRouteStructureRequest(fen: string, candidates: DecisionEngineLine[], probes: DecisionReplyProbe[]) {
    const route = nominateCaptureRouteStructure(fen, candidates);
    if (!route || probes.some(probe => probe.moveUci === route.take.uci) ||
        !checkingPaths(fen, route, probes.find(probe => probe.moveUci === route.leading.pvUci[0]))) return;
    return { moveUci: route.take.uci, fen: makeFen(route.take.after.toSetup()) };
}

/** The search compares choices, while the claim itself is about board facts. */
export function verifyCaptureRouteStructure(
    fen: string,
    candidates: DecisionEngineLine[],
    probes: DecisionReplyProbe[],
    added?: DecisionReplyProbe,
): PositionStrategicPlan | undefined {
    const route = nominateCaptureRouteStructure(fen, candidates);
    if (!route || [route.leading, route.alternative].some(line => measureDecisionLine(fen, line)?.drawnEnding !== false))
        return;
    const check = checkingPaths(fen, route, probes.find(probe => probe.moveUci === route.leading.pvUci[0]));
    const alternative = probes.find(probe => probe.moveUci === route.take.uci) ?? added;
    const direct = replyAt(route.take, alternative, 1)?.[0];
    if (!check || !qualified(direct) || direct.cp - check.best.cp < MIN_PREFERENCE ||
        Math.abs(direct.cp + route.alternative.cp) > 90) return;
    const plain = [
        replayTacticalLine(fen, route.alternative.pvUci.slice(0, WINDOW + 2)),
        replayTacticalLine(fen, [route.take.uci, ...direct.pvUci.slice(0, WINDOW + 1)]),
    ];
    if (plain.some(steps => steps.length < WINDOW)) return;
    const endings = [...check.finished, ...plain.map(settled)].map(steps => steps.at(-1)!.balance);
    if (Math.max(...endings) - Math.min(...endings) > 100) return;
    const [withCheck] = check.finished;
    const routeSan = withCheck.slice(0, 3).map(step => step.san).join(" ");
    return {
        description: `After ${routeSan}, the pawn on ${makeSquare(check.link.from)} still supports ${makeSquare(check.link.to)}. Taking the same ${route.victim.role} immediately with ${route.take.san} breaks that pawn link.`,
        linesUci: [withCheck.map(step => step.uci), settled(plain[1]).map(step => step.uci)],
    };
}
