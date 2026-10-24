import type { TreeStoreState } from "@/state/store/tree";
import { gameReportGameKey } from "./gameReportOwnership";
import { hasCompleteGameAnalysis } from "./gameAnalysisReport";
import { type GameReportLimit, validGameReportLimit } from "./gameAnalysisSettings";
import type { TreeNode } from "./treeReducer";

export const GAME_REPORT_RUN_HEADER = "ECGameAnalysis";
export interface GameReportRun {
    version: 1;
    engine: string;
    limit: GameReportLimit;
    completedAt: string;
    fingerprint: string;
}

// Bind the recorded limits to the game AND its saved evaluation evidence.
// Comments, drawings, navigation and subsequent preference changes are free
// to change without pretending another engine run took place.
export function gameReportEvidenceKey(root: TreeNode): string | null {
    const game = gameReportGameKey(root);
    if (!game || !hasCompleteGameAnalysis(root)) return null;
    const scores: unknown[] = [];
    let node: TreeNode | undefined = root;
    while (node) {
        const value = node.score?.value;
        scores.push([
            value?.type ?? null,
            value ? Math.round(value.value * 1e6) / 1e6 : null,
            node.depth,
        ]);
        node = node.children[0];
    }
    return JSON.stringify([game, scores]);
}

async function fingerprint(evidence: string): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(evidence));
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function recordGameReportRun(
    store: { getState: () => Pick<TreeStoreState, "root" | "setReportRun"> },
    details: { engine: string; limit: GameReportLimit },
    isCurrent: () => boolean,
): Promise<void> {
    const evidence = gameReportEvidenceKey(store.getState().root);
    if (!evidence || !validGameReportLimit(details.limit)) return;
    const run: GameReportRun = {
        version: 1,
        engine: details.engine.trim().slice(0, 160),
        limit: structuredClone(details.limit),
        completedAt: new Date().toISOString(),
        fingerprint: await fingerprint(evidence),
    };
    if (isCurrent() && gameReportEvidenceKey(store.getState().root) === evidence) {
        // URI encoding makes this a portable PGN tag without quote/newline
        // escaping, and the existing session store retains the same headers.
        store.getState().setReportRun(encodeURIComponent(JSON.stringify(run)));
    }
}

export async function readGameReportRun(
    raw: string | undefined,
    root: TreeNode,
): Promise<GameReportRun | null> {
    if (!raw || raw.length > 4096) return null;
    try {
        const run: unknown = JSON.parse(decodeURIComponent(raw));
        if (!run || typeof run !== "object") return null;
        const saved = run as GameReportRun;
        if (
            saved.version !== 1 ||
            typeof saved.engine !== "string" ||
            saved.engine.length > 160 ||
            !validGameReportLimit(saved.limit) ||
            typeof saved.completedAt !== "string" ||
            !Number.isFinite(Date.parse(saved.completedAt)) ||
            typeof saved.fingerprint !== "string" ||
            !/^[a-f0-9]{64}$/.test(saved.fingerprint)
        )
            return null;
        const evidence = gameReportEvidenceKey(root);
        return evidence && (await fingerprint(evidence)) === saved.fingerprint ? saved : null;
    } catch {
        return null;
    }
}
