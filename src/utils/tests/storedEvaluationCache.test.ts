import { createStore } from "jotai";
import { beforeEach, expect, it, vi } from "vitest";
import type { BestMoves } from "@/bindings";
import {
    currentLiveEvalAtom,
    engineMovesFamily,
    enginesAtom,
    useStoredEvaluationsAtom,
} from "@/state/atoms";
import { enginePreferences } from "@/utils/enginePreferences";
import type { Engine } from "@/utils/engines";
import { evaluationSourceEpochAtom } from "@/state/evaluationSource";
import { getEvaluationSourceEpoch, noteEvaluationSourceRevision } from "@/utils/evaluationSource";

const io = vi.hoisted(() => ({ disk: "[]" }));
vi.mock("@/utils/enginePreferences", async () => {
    const { createEnginePreferenceStore } = await import("@/utils/enginePreferenceStore");
    return {
        enginePreferences: createEnginePreferenceStore({
            read: async () => io.disk,
            write: async (text) => {
                io.disk = text;
            },
        }),
    };
});
const local: Engine = {
    id: "local",
    type: "local",
    name: "Fixture UCI",
    path: "C:/Fixture/engine.exe",
    version: "fixture",
    loaded: true,
};
const cloud: Engine = {
    id: "cloud",
    type: "lichess",
    name: "Explicit cloud",
    url: "https://fixture.invalid",
    loaded: true,
};
const line = (source?: string): BestMoves =>
    ({
        source,
        depth: 20,
        nodes: 100,
        nps: 1000,
        multipv: 1,
        score: { value: { type: "cp", value: 25 }, wdl: null },
        uciMoves: ["e2e4"],
        sanMoves: ["e4"],
    }) as BestMoves;
beforeEach(async () => {
    io.disk = JSON.stringify([local, cloud]);
    await enginePreferences.reload();
    localStorage.clear();
});
async function setup() {
    const store = createStore(),
        unsubscribe = store.sub(enginesAtom, () => {});
    await vi.waitFor(() => expect(store.get(enginesAtom)?.length).toBe(2));
    return { store, unsubscribe };
}
it("hides a previously cached stored score immediately when local-only is selected", async () => {
    const { store, unsubscribe } = await setup();
    try {
        const cache = engineMovesFamily({ tab: "fixture", engine: local.id });
        store.set(cache, new Map([["fen", [line("lichess")]]]));
        store.set(useStoredEvaluationsAtom, false);
        expect(store.get(cache).get("fen")).toBeUndefined();
    } finally {
        unsubscribe();
    }
});
it("rejects a late cloud cache write while retaining actual local lines", async () => {
    const { store, unsubscribe } = await setup();
    try {
        const cache = engineMovesFamily({ tab: "fixture", engine: local.id });
        store.set(useStoredEvaluationsAtom, false);
        const native = line();
        store.set(cache, new Map([["fen", [line("lichess"), native]]]));
        expect(store.get(cache).get("fen")).toEqual([native]);
    } finally {
        unsubscribe();
    }
});
it("retains a separately enabled cloud profile when local-engine stored lookup is off", async () => {
    const { store, unsubscribe } = await setup();
    try {
        const cache = engineMovesFamily({ tab: "fixture", engine: cloud.id });
        const stored = line("lichess");
        store.set(useStoredEvaluationsAtom, false);
        store.set(cache, new Map([["fen", [stored]]]));
        expect(store.get(cache).get("fen")).toEqual([stored]);
    } finally {
        unsubscribe();
    }
});
it("hides the stored local score fallback without hiding engine or explicit cloud scores", async () => {
    const { store, unsubscribe } = await setup();
    try {
        store.set(currentLiveEvalAtom, {
            fen: "fen",
            movesKey: "",
            score: line().score,
            storedForLocal: true,
        });
        store.set(useStoredEvaluationsAtom, false);
        expect(store.get(currentLiveEvalAtom)).toBeNull();
        store.set(currentLiveEvalAtom, {
            fen: "fen",
            movesKey: "",
            score: line().score,
            storedForLocal: false,
        });
        expect(store.get(currentLiveEvalAtom)?.score).toEqual(line().score);
    } finally {
        unsubscribe();
    }
});

it("drops previous-store lines and rejects their late writes while retaining UCI evidence", async () => {
    const { store, unsubscribe } = await setup();
    const stop = store.sub(evaluationSourceEpochAtom, () => {});
    try {
        const epoch = getEvaluationSourceEpoch();
        const cache = engineMovesFamily({ tab: "source-change", engine: local.id });
        const native = line(),
            old = { ...line("lichess"), evaluationSourceEpoch: epoch };
        store.set(cache, new Map([["fen", [old, native]]]));
        store.set(currentLiveEvalAtom, {
            fen: "fen",
            movesKey: "",
            score: old.score,
            storedForLocal: true,
            evaluationSourceEpoch: epoch,
        });
        noteEvaluationSourceRevision("fixture-change");
        expect(store.get(cache).get("fen")).toEqual([native]);
        expect(store.get(currentLiveEvalAtom)).toBeNull();
        store.set(cache, new Map([["fen", [old, native]]]));
        expect(store.get(cache).get("fen")).toEqual([native]);
        const fresh = { ...line("lichess"), evaluationSourceEpoch: getEvaluationSourceEpoch() };
        store.set(cache, new Map([["fen", [fresh]]]));
        expect(store.get(cache).get("fen")).toEqual([fresh]);
    } finally {
        stop();
        unsubscribe();
    }
});
