import type { PlanExplorerLine, PlanExplorerPiece, PlanExplorerSetup } from "@/bindings";
import type { DatabaseResultPerspective } from "@/utils/db";
import {
    type EnginePlan,
    type EnginePlanEvidence,
    type EnginePlanReport,
    type EnginePlanSetup,
    getPlanExplorerLineEnginePlan,
} from "@/utils/enginePlanExplorer";
import {
    blendExpectedScores,
    cpToExpectedScore,
    getBlendEngineWeight,
    getEngineScoreSpreadCp,
    getPracticalWdlRate,
    getShrunkPracticalScore,
    type MoveStrengthSettings,
    normalizeMoveStrengthSettings,
    wdlToExpectedScore,
} from "@/utils/moveStrength";

type Side = "white" | "black";
type SideFilter = "all" | "white" | "black";

/**
 * Draw weight used for the Plan Explorer practical rows. Deliberately matches the
 * Results column (0.5) so the two columns agree on draw-heavy positions.
 */
export const PLAN_STRENGTH_DRAW_WEIGHT = 0.5;

export type PlanStrength = {
    score: number;
    label: string;
    detail: string;
    expected: number;
    practicalExpected: number | null;
    engineExpected: number | null;
    engineCpLoss: number | null;
    engineUnsafe: boolean;
    engineMissing: boolean;
    usingEngine: boolean;
};

type StrengthCandidate = {
    key: string;
    perspective: Side;
    games: number;
    practicalRaw: number | null;
    engineExpected: number | null;
    engineCpLoss: number | null;
    coverage: number;
};

export function buildPlanStrengthByKey(
    pieces: PlanExplorerPiece[],
    engineReport: EnginePlanReport | null,
    resultPerspective: DatabaseResultPerspective | null,
    strengthSettings: Partial<MoveStrengthSettings> | null | undefined,
): Map<string, PlanStrength> {
    const settings = normalizeMoveStrengthSettings(strengthSettings);
    const usingEngine = !!engineReport;
    const effectiveSettings = usingEngine ? settings : { ...settings, mode: "practical" as const };

    const candidates: StrengthCandidate[] = pieces.flatMap((piece) =>
        piece.lines.map((line) => {
            const perspective = toSide(resultPerspective ?? piece.color);
            const games = line.white + line.draw + line.black;
            const practicalRaw =
                games > 0
                    ? getPracticalWdlRate(
                          { white: line.white, draw: line.draw, black: line.black },
                          perspective,
                          PLAN_STRENGTH_DRAW_WEIGHT,
                      )
                    : null;
            const engine = engineReport
                ? getLineEngineComponents(piece, line, engineReport, effectiveSettings)
                : { engineExpected: null, engineCpLoss: null };
            return {
                key: planLineKey(piece, line),
                perspective,
                games,
                practicalRaw,
                engineExpected: engine.engineExpected,
                engineCpLoss: engine.engineCpLoss,
                coverage: 1,
            };
        }),
    );

    return finalizeStrengthMap(candidates, effectiveSettings, usingEngine);
}

export function buildSetupStrengthByKey(
    setups: PlanExplorerSetup[],
    engineReport: EnginePlanReport | null,
    resultPerspective: DatabaseResultPerspective | null,
    sideFilter: SideFilter,
    fen: string,
    strengthSettings: Partial<MoveStrengthSettings> | null | undefined,
): Map<string, PlanStrength> {
    const settings = normalizeMoveStrengthSettings(strengthSettings);
    const usingEngine = !!engineReport;
    const effectiveSettings = usingEngine ? settings : { ...settings, mode: "practical" as const };

    const candidates: StrengthCandidate[] = setups.map((setup) => {
        const perspective = getSetupPerspective(setup, resultPerspective, sideFilter, fen);
        const games = setup.white + setup.draw + setup.black;
        const practicalRaw =
            games > 0
                ? getPracticalWdlRate(
                      { white: setup.white, draw: setup.draw, black: setup.black },
                      perspective,
                      PLAN_STRENGTH_DRAW_WEIGHT,
                  )
                : null;
        const engine = engineReport
            ? getSetupEngineComponents(setup, engineReport, effectiveSettings)
            : { engineExpected: null, engineCpLoss: null, coverage: 0 };
        return {
            key: planSetupKey(setup),
            perspective,
            games,
            practicalRaw,
            engineExpected: engine.engineExpected,
            engineCpLoss: engine.engineCpLoss,
            coverage: engine.coverage,
        };
    });

    return finalizeStrengthMap(candidates, effectiveSettings, usingEngine);
}

function finalizeStrengthMap(
    candidates: StrengthCandidate[],
    settings: MoveStrengthSettings,
    usingEngine: boolean,
): Map<string, PlanStrength> {
    const poolAverages = getPoolAverages(candidates);
    const engineScoreSpreadCp = getEngineScoreSpreadCp(
        candidates.map((candidate) =>
            candidate.engineCpLoss === null ? null : -candidate.engineCpLoss,
        ),
    );

    return new Map(
        candidates.map((candidate) => {
            const baseline = poolAverages.get(candidate.perspective) ?? 0.5;
            const practicalExpected = getShrunkPracticalScore({
                score: candidate.practicalRaw,
                games: candidate.games,
                baseline,
            });
            const blend = blendExpectedScores({
                settings,
                engineExpected: candidate.engineExpected,
                engineCpLoss: candidate.engineCpLoss,
                hasEngine: usingEngine,
                practicalExpected,
                engineScoreSpreadCp,
                coverage: candidate.coverage,
            });
            const engineCpLoss = usingEngine ? candidate.engineCpLoss : null;
            const strength: PlanStrength = {
                score: blend.score,
                label: String(blend.score),
                expected: blend.expected,
                practicalExpected,
                engineExpected: candidate.engineExpected,
                engineCpLoss,
                engineUnsafe: blend.engineUnsafe,
                engineMissing: blend.engineMissing,
                usingEngine,
                detail: formatPlanStrengthDetail({
                    settings,
                    usingEngine,
                    score: blend.score,
                    engineExpected: candidate.engineExpected,
                    engineCpLoss,
                    engineUnsafe: blend.engineUnsafe,
                    engineMissing: blend.engineMissing,
                    practicalExpected,
                    practicalRaw: candidate.practicalRaw,
                    games: candidate.games,
                    engineScoreSpreadCp,
                }),
            };
            return [candidate.key, strength] as const;
        }),
    );
}

function getPoolAverages(candidates: StrengthCandidate[]): Map<Side, number> {
    const grouped = new Map<Side, { totalGames: number; weightedScore: number }>();
    for (const candidate of candidates) {
        const current = grouped.get(candidate.perspective) ?? { totalGames: 0, weightedScore: 0 };
        current.totalGames += candidate.games;
        if (candidate.practicalRaw !== null) {
            current.weightedScore += candidate.practicalRaw * candidate.games;
        }
        grouped.set(candidate.perspective, current);
    }

    return new Map(
        [...grouped.entries()].map(([perspective, value]) => [
            perspective,
            value.totalGames > 0 ? value.weightedScore / value.totalGames : 0.5,
        ]),
    );
}

function getLineEngineComponents(
    piece: Pick<PlanExplorerPiece, "color" | "role">,
    line: PlanExplorerLine,
    engineReport: EnginePlanReport,
    settings: MoveStrengthSettings,
): { engineExpected: number | null; engineCpLoss: number | null } {
    const match = getPlanExplorerLineEnginePlan(piece, line, engineReport);
    if (!match) return { engineExpected: null, engineCpLoss: null };
    return getEnginePlanComponents(match.plan, toSide(piece.color), settings);
}

function getSetupEngineComponents(
    setup: PlanExplorerSetup,
    engineReport: EnginePlanReport,
    settings: MoveStrengthSettings,
): { engineExpected: number | null; engineCpLoss: number | null; coverage: number } {
    const total = setup.plans.length;
    const matched = setup.plans
        .map((plan) => {
            const match = getPlanExplorerLineEnginePlan(plan, plan.line, engineReport);
            if (!match) return null;
            return getEnginePlanComponents(match.plan, toSide(plan.color), settings);
        })
        .filter(
            (
                value,
            ): value is { engineExpected: number | null; engineCpLoss: number | null } =>
                value !== null,
        );
    const coverage = total > 0 ? matched.length / total : 0;
    if (matched.length === 0) return { engineExpected: null, engineCpLoss: null, coverage: 0 };

    const expecteds = matched
        .map((entry) => entry.engineExpected)
        .filter((value): value is number => value !== null);
    const losses = matched
        .map((entry) => entry.engineCpLoss)
        .filter((value): value is number => value !== null);
    const engineExpected = expecteds.length > 0 ? mean(expecteds) : null;
    const engineCpLoss =
        losses.length > 0 ? mean(losses) * 0.45 + Math.max(...losses) * 0.55 : null;

    // Guarantee the blend's engineMissing (engineExpected === null) stays in sync
    // with a zero-coverage setup so the row shrinks toward neutral consistently.
    return { engineExpected, engineCpLoss, coverage: engineExpected === null ? 0 : coverage };
}

function getEnginePlanComponents(
    plan: EnginePlan,
    ownerColor: Side,
    settings: MoveStrengthSettings,
): { engineExpected: number | null; engineCpLoss: number | null } {
    const engineCpLoss =
        plan.bestCpLoss ?? plan.weightedCpLoss ?? getEnginePlanBucketCpLoss(plan, settings);
    const engineExpected = getEngineEvidenceExpectedScore(plan, ownerColor);
    return { engineExpected, engineCpLoss };
}

/**
 * Expected score (0..1) for an engine plan or setup from the OWNER's perspective.
 * Both the UCI WDL triple and bestEvalCp are WHITE-relative in this codebase
 * (the Rust side already flips them for a black side-to-move before emitting),
 * so a black owner reverses the WDL triple / mirrors the cp expectation. Returns
 * null when neither a WDL triple nor a cp eval is available.
 */
export function getEngineEvidenceExpectedScore(
    source: { evidence: EnginePlanEvidence[]; bestEvalCp: number | null },
    ownerColor: Side,
): number | null {
    const wdl = bestEvidenceLine(source.evidence)?.score.wdl ?? null;
    if (wdl) {
        const oriented: [number, number, number] =
            ownerColor === "white" ? wdl : [wdl[2], wdl[1], wdl[0]];
        return wdlToExpectedScore(oriented);
    }

    if (source.bestEvalCp !== null) {
        const expected = cpToExpectedScore(source.bestEvalCp);
        return ownerColor === "black" ? 1 - expected : expected;
    }

    return null;
}

function bestEvidenceLine(evidence: EnginePlanEvidence[]): EnginePlanEvidence | null {
    let best: EnginePlanEvidence | null = null;
    for (const line of evidence) {
        if (line.qualityCp === null) continue;
        if (!best || best.qualityCp === null || best.qualityCp < line.qualityCp) {
            best = line;
        }
    }
    return best ?? evidence[0] ?? null;
}

/**
 * Approval-bucket cp-loss fallback, ported verbatim from the panel's former
 * getEnginePlanCpLoss. Only used when a matched plan carries no measured
 * bestCpLoss/weightedCpLoss.
 */
function getEnginePlanBucketCpLoss(plan: EnginePlan, settings: MoveStrengthSettings): number {
    const maxLoss = Math.max(1, settings.maxEngineCpLoss);
    const approvalLoss = (() => {
        switch (plan.approval) {
            case "Strong":
                return plan.appearsInTopPv ? 0 : maxLoss * 0.12;
            case "OK":
                return maxLoss * 0.38;
            case "Unclear":
                return maxLoss * 0.72;
            case "Weak":
                return maxLoss * 1.15;
        }
    })();
    const confidencePenalty =
        plan.confidence === "High" ? 0 : plan.confidence === "Medium" ? maxLoss * 0.08 : maxLoss * 0.16;
    const supportBonus = Math.min(
        maxLoss * 0.18,
        Math.max(0, plan.supportCount - 1) * maxLoss * 0.05,
    );

    return Math.max(0, approvalLoss + confidencePenalty - supportBonus);
}

export type EngineSetupStrength = {
    score: number; // 0-100
    ownerExpected: number; // 0..1, owner-perspective expected score of the evidence
    realization: number; // 0..1
    viableShare: number; // 0..1
    pvBackedShare: number; // 0..1, plans with origin !== "template" / total plans
    earlyCompletion: number; // 0..1
    engineCpLoss: number | null;
    engineUnsafe: boolean;
    detail: string;
};

/**
 * Continuous engine-only strength (0-100) for a setup. Starts from the owner's
 * expected score and shrinks it toward NEUTRAL (0.5) by a realization factor that
 * rewards viable-PV share, PV-backed (non-template) components and early
 * completion — so a thin-evidence good setup reads ~50 rather than ~0. Returns
 * null when the evidence carries no usable eval (caller renders n/a, sorts last).
 */
export function computeEngineSetupStrength({
    setup,
    settings,
}: {
    setup: EnginePlanSetup;
    settings: MoveStrengthSettings;
}): EngineSetupStrength | null {
    const ownerExpected = getEngineEvidenceExpectedScore(setup, setup.color);
    if (ownerExpected === null) return null;

    const plans = setup.plans;
    const pvBackedCount = plans.filter((plan) => plan.origin !== "template").length;
    const viableShare = clamp(setup.supportRatio, 0, 1);
    const pvBackedShare = pvBackedCount / Math.max(1, plans.length);
    const earlyCompletion =
        setup.medianCompletionPly === null
            ? 0.5
            : clamp(1 - (setup.medianCompletionPly - 8) / 16, 0, 1);
    const realization = clamp(
        0.3 + 0.4 * viableShare + 0.2 * pvBackedShare + 0.1 * earlyCompletion,
        0,
        1,
    );
    const adjusted = 0.5 + (ownerExpected - 0.5) * realization;
    const score = Math.round(adjusted * 100);
    const engineCpLoss = getEngineSetupCpLoss(setup, settings);
    const engineUnsafe =
        engineCpLoss !== null && engineCpLoss > Math.max(1, settings.maxEngineCpLoss);

    const detail: string[] = [
        `Engine setup strength ${score}`,
        `Owner expected ${formatPercent(ownerExpected)} from ${setup.supportCount} PVs (${formatPercent(
            viableShare,
        )} viable share)`,
        `${pvBackedCount}/${plans.length} components engine-backed`,
        setup.medianCompletionPly !== null
            ? `Typically complete by move ${Math.floor(setup.medianCompletionPly / 2) + 1}`
            : "Completion timing unknown",
        engineCpLoss === null
            ? "CP loss unavailable"
            : `${Math.round(engineCpLoss)} cp behind best line`,
    ];
    if (engineUnsafe) detail.push("Over the configured CP-drop limit");

    return {
        score,
        ownerExpected,
        realization,
        viableShare,
        pvBackedShare,
        earlyCompletion,
        engineCpLoss,
        engineUnsafe,
        detail: detail.join(". "),
    };
}

/**
 * Blended cp-loss for an engine setup. Ported verbatim from the panel's former
 * copy (reindented to this file's style): weights the setup's own measured
 * cp-loss with its component plans, falling back to approval-bucket estimates
 * when no measured loss is available.
 */
export function getEngineSetupCpLoss(setup: EnginePlanSetup, settings: MoveStrengthSettings) {
    const setupCpLoss = setup.bestCpLoss ?? setup.weightedCpLoss;
    const planCpLosses = setup.plans
        .map((plan) => plan.bestCpLoss ?? plan.weightedCpLoss)
        .filter((value): value is number => value !== null);

    if (setupCpLoss !== null) {
        if (planCpLosses.length === 0) return setupCpLoss;

        const average = planCpLosses.reduce((sum, loss) => sum + loss, 0) / planCpLosses.length;
        const worst = Math.max(...planCpLosses);
        return setupCpLoss * 0.65 + average * 0.2 + worst * 0.15;
    }

    const maxLoss = Math.max(1, settings.maxEngineCpLoss);
    const setupLoss = getEngineEvidenceCpLoss({
        approval: setup.approval,
        confidence: setup.confidence,
        supportCount: setup.supportCount,
        appearsInTopPv: setup.appearsInTopPv,
        maxLoss,
    });
    const planLosses = setup.plans.map(
        (plan) =>
            plan.bestCpLoss ??
            plan.weightedCpLoss ??
            getEngineEvidenceCpLoss({
                approval: plan.approval,
                confidence: plan.confidence,
                supportCount: plan.supportCount,
                appearsInTopPv: plan.appearsInTopPv,
                maxLoss,
            }),
    );
    if (planLosses.length === 0) return setupLoss;

    const average = planLosses.reduce((sum, loss) => sum + loss, 0) / planLosses.length;
    const worst = Math.max(...planLosses);
    return setupLoss * 0.5 + average * 0.25 + worst * 0.25;
}

/**
 * Approval-bucket cp-loss estimate for an engine plan/setup with no measured
 * loss. Ported verbatim from the panel (reindented to this file's style).
 */
export function getEngineEvidenceCpLoss({
    approval,
    confidence,
    supportCount,
    appearsInTopPv,
    maxLoss,
}: {
    approval: EnginePlan["approval"];
    confidence: EnginePlan["confidence"];
    supportCount: number;
    appearsInTopPv: boolean;
    maxLoss: number;
}) {
    const approvalLoss = (() => {
        switch (approval) {
            case "Strong":
                return appearsInTopPv ? 0 : maxLoss * 0.12;
            case "OK":
                return maxLoss * 0.38;
            case "Unclear":
                return maxLoss * 0.72;
            case "Weak":
                return maxLoss * 1.15;
        }
    })();
    const confidencePenalty =
        confidence === "High" ? 0 : confidence === "Medium" ? maxLoss * 0.08 : maxLoss * 0.16;
    const supportBonus = Math.min(maxLoss * 0.18, Math.max(0, supportCount - 1) * maxLoss * 0.05);

    return Math.max(0, approvalLoss + confidencePenalty - supportBonus);
}

export function formatPlanStrengthDetail({
    settings,
    usingEngine,
    score,
    engineExpected,
    engineCpLoss,
    engineUnsafe,
    engineMissing,
    practicalExpected,
    practicalRaw,
    games,
    engineScoreSpreadCp,
}: {
    settings: MoveStrengthSettings;
    usingEngine: boolean;
    score: number;
    engineExpected: number | null;
    engineCpLoss: number | null;
    engineUnsafe: boolean;
    engineMissing: boolean;
    practicalExpected: number | null;
    practicalRaw: number | null;
    games: number;
    engineScoreSpreadCp: number | null;
}): string {
    const parts: string[] = [`Expected score ${score}`];
    parts.push(
        usingEngine
            ? `${formatMode(settings.mode)} mode, ${Math.round(
                  getBlendEngineWeight(settings, engineScoreSpreadCp) * 100,
              )}% engine blend, max ${settings.maxEngineCpLoss} cp drop`
            : "Practical only until engine strength is available",
    );

    if (usingEngine) {
        if (engineMissing || engineExpected === null) {
            parts.push("No matching engine plan — practical only, shrunk toward neutral");
        } else if (engineCpLoss === null) {
            parts.push(`Engine ${formatPercent(engineExpected)}`);
        } else {
            parts.push(
                `Engine ${formatPercent(engineExpected)} (${Math.round(engineCpLoss)} cp behind best PV)`,
            );
        }
    }

    if (practicalExpected === null) {
        parts.push("WDL unavailable");
    } else {
        const rawText = practicalRaw === null ? "" : ` (raw ${formatPercent(practicalRaw)})`;
        parts.push(
            `Practical ${formatPercent(practicalExpected)} over ${games.toLocaleString()} games${rawText}`,
        );
    }

    if (engineUnsafe) {
        parts.push("Over the configured CP-drop limit");
    }

    return parts.join(". ");
}

export function planLineKey(
    piece: Pick<PlanExplorerPiece, "color" | "role" | "from">,
    line: PlanExplorerLine,
): string {
    return `${piece.color}|${piece.role}|${piece.from}|${line.squares.join("-")}`;
}

export function planSetupKey(setup: PlanExplorerSetup): string {
    return setup.plans.map((plan) => planLineKey(plan, plan.line)).join("||");
}

export function setupSide(setup: PlanExplorerSetup): Side | null {
    const colors = new Set(setup.plans.map((plan) => plan.color));
    if (colors.size !== 1) return null;

    const color = setup.plans[0]?.color;
    return color === "white" || color === "black" ? color : null;
}

export function getSetupPerspective(
    setup: PlanExplorerSetup,
    resultPerspective: DatabaseResultPerspective | null,
    sideFilter: SideFilter,
    fen: string | null,
): Side {
    if (resultPerspective === "white" || resultPerspective === "black") return resultPerspective;
    if (sideFilter === "white" || sideFilter === "black") return sideFilter;

    const setupColor = setupSide(setup);
    if (setupColor) return setupColor;

    return fen?.split(" ")[1] === "b" ? "black" : "white";
}

function toSide(color: string): Side {
    return color === "black" ? "black" : "white";
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function formatMode(mode: MoveStrengthSettings["mode"]): string {
    switch (mode) {
        case "smart":
            return "Smart";
        case "engine":
            return "Engine";
        case "practical":
            return "Practical";
    }
}

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}
