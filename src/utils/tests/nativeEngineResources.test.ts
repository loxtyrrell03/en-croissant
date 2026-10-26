import { expect, it } from "vitest";
import type { Engine, EngineSettings } from "../engines";
import type { Tab } from "../tabs";
import {
    analysisResourceScope,
    sameAnalysisEngine,
    withCpuResources,
} from "../nativeEngineResources";

const local: Engine = {
    type: "local",
    id: "fixture",
    name: "CPU",
    path: "C:/Fixture/cpu.exe",
    version: "19",
};
it("keeps labels and preference snapshots out of engine identity, but rejects replacement paths and ids", () => {
    expect(
        sameAnalysisEngine(
            { ...local, name: "Owner label", settings: [{ name: "Threads", value: 10 }] },
            local,
        ),
    ).toBe(true);
    expect(sameAnalysisEngine({ ...local, path: "C:/Fixture/other.exe" }, local)).toBe(false);
    expect(sameAnalysisEngine({ ...local, id: "other" }, local)).toBe(false);
    expect(sameAnalysisEngine(undefined, local)).toBe(false);
});
it("retains independent cloud and PC engine identities, URLs and engine kinds", () => {
    const pc: Engine = {
        type: "pc",
        id: "fixture",
        name: "PC",
        engineKind: "stockfish",
        url: "https://fixture.invalid/",
    };
    expect(sameAnalysisEngine(pc, pc)).toBe(true);
    expect(sameAnalysisEngine({ ...pc, engineKind: "lc0" }, pc)).toBe(false);
    expect(sameAnalysisEngine({ ...pc, url: "https://other.invalid/" }, pc)).toBe(false);
    expect(sameAnalysisEngine(pc, local)).toBe(false);
    const cloud: Engine = {
        type: "lichess",
        id: "fixture",
        name: "Stored",
        url: "https://fixture.invalid/",
    };
    expect(sameAnalysisEngine({ ...cloud, name: "Owner name" }, cloud)).toBe(true);
    expect(sameAnalysisEngine({ ...cloud, type: "chessdb" }, cloud)).toBe(false);
});
it("owns the selected tab and database game while allowing unrelated display changes", () => {
    const tab: Tab = {
        value: "a",
        name: "Game",
        type: "analysis",
        gameOrigin: {
            kind: "database",
            database: "C:/Fixture/games.db3",
            gameId: 7,
            sourceIdentity: "before",
        },
    };
    expect(
        analysisResourceScope({
            ...tab,
            name: "Edited title",
            gameOrigin: {
                kind: "database",
                database: "C:/Fixture/games.db3",
                gameId: 7,
                sourceIdentity: "after",
            },
        }),
    ).toBe(analysisResourceScope(tab));
    expect(analysisResourceScope({ ...tab, value: "b" })).not.toBe(analysisResourceScope(tab));
    expect(
        analysisResourceScope({
            ...tab,
            gameOrigin: { kind: "database", database: "C:/Fixture/games.db3", gameId: 8 },
        }),
    ).not.toBe(analysisResourceScope(tab));
    expect(analysisResourceScope(undefined)).toBeNull();
});
it("changes only verified CPU options in a new snapshot and can fill absent profile defaults", () => {
    const settings: EngineSettings = [
        { name: "MultiPV", value: 4 },
        { name: "Hash", value: 333 },
        { name: "Owner", value: "keep" },
    ];
    const before = structuredClone(settings);
    const next = withCpuResources(settings, { threads: 7, hashMb: 777 });
    expect(settings).toEqual(before);
    expect(next).toEqual([
        { name: "MultiPV", value: 4 },
        { name: "Hash", value: 777 },
        { name: "Owner", value: "keep" },
        { name: "Threads", value: 7 },
    ]);
});
