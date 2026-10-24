import { expect, test } from "vitest";
import { openWebOtbPrepLink, readWebOtbPrepLink } from "../otbPrepLink";
import { createEmptyWebState } from "../storage";
import { parsePgnDatabase } from "../pgn";
import type { WebOtbImportJob } from "../otbImport";

function job() {
    return {
        id: "otb-example",
        status: "completed",
        request: { playerName: "Example, Alex" },
        report: { playerName: "Example, Alex" },
        createdAt: "2026-10-18T12:00:00Z",
        prepDatabase: parsePgnDatabase(
            "Alex Example.pgn",
            '[White "Example, Alex"]\n[Black "Other"]\n\n1. e4 e5 *',
            1234,
        ),
    } as WebOtbImportJob;
}
test("links require an explicit user side and a local job identifier", () => {
    expect(readWebOtbPrepLink("?otbPrep=otb-example&side=black")).toEqual({
        jobId: "otb-example",
        userColor: "black",
    });
    for (const value of [
        "?otbPrep=otb-example",
        "?otbPrep=../../x&side=white",
        "?otbPrep=https://example.com&side=white",
        "?otbPrep=otb-example&side=opponent",
    ])
        expect(readWebOtbPrepLink(value)).toBeNull();
});
test("opens all games ready to train with Black at the bottom", () => {
    const completed = job();
    completed.prepDatabase!.games.push({
        ...completed.prepDatabase!.games[0],
        id: "header-only",
        moves: [],
    });
    const next = openWebOtbPrepLink(createEmptyWebState(), completed, "black");
    expect(next.board).toMatchObject({ orientation: "black", cursor: 0 });
    expect(next.prepWorkspaces[0]).toMatchObject({
        userColor: "black",
        opponent: "Example, Alex",
        panelStage: "train",
    });
    expect(next.gamesByDatabase[next.databases[0].id]).toHaveLength(1);
    expect(next.databases[0].gameCount).toBe(1);
});
test("reopening preserves existing annotations and other workspaces while selecting the requested side", () => {
    const original = openWebOtbPrepLink(createEmptyWebState(), job(), "white");
    original.prepWorkspaces[0].notesByFen.start = "Keep this";
    original.prepWorkspaces[0].preparedMoves.e4 = 123;
    original.gamesByDatabase[original.databases[0].id][0].event = "My edited event";
    original.prepWorkspaces.push({ ...original.prepWorkspaces[0], id: "unrelated" });
    const next = openWebOtbPrepLink(original, job(), "black");
    expect(next.prepWorkspaces).toHaveLength(2);
    expect(next.prepWorkspaces[0]).toMatchObject({
        userColor: "black",
        notesByFen: { start: "Keep this" },
        preparedMoves: { e4: 123 },
    });
    expect(next.gamesByDatabase[next.databases[0].id][0].event).toBe("My edited event");
    expect(next.prepWorkspaces[1]).toBe(original.prepWorkspaces[1]);
});
test("does not silently recreate an intentionally removed prep or open incomplete jobs", () => {
    const original = openWebOtbPrepLink(createEmptyWebState(), job(), "white");
    original.prepWorkspaces = [];
    expect(() => openWebOtbPrepLink(original, job(), "black")).toThrow("removed");
    expect(() =>
        openWebOtbPrepLink(createEmptyWebState(), { ...job(), status: "running" }, "black"),
    ).toThrow("completed games");
});
