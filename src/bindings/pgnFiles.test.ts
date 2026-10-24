import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { pgnFiles } from "./pgnFiles";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

it("uses the native camel-case source identity protocol and propagates rejections", async () => {
    const source = { file: "temp.pgn", index: 2, identity: "captured" };
    await pgnFiles.read("a.pgn", 2);
    await pgnFiles.readBatch("a.pgn", 2, 4);
    await pgnFiles.write("a.pgn", 2, "captured", "PGN", "{}");
    await pgnFiles.create("copy.pgn", "PGN", "{}", source);
    await pgnFiles.append("a.pgn", "PGN", "{}");
    await pgnFiles.remove("a.pgn", 2, "captured");
    expect(vi.mocked(invoke).mock.calls).toEqual([
        ["read_pgn_game", { filePath: "a.pgn", index: 2 }],
        ["read_pgn_games", { filePath: "a.pgn", start: 2, end: 4 }],
        [
            "write_game",
            { filePath: "a.pgn", n: 2, expectedIdentity: "captured", pgn: "PGN", metadata: "{}" },
        ],
        ["create_pgn_game", { filePath: "copy.pgn", pgn: "PGN", metadata: "{}", source }],
        ["append_pgn_game", { filePath: "a.pgn", pgn: "PGN", metadata: "{}" }],
        ["delete_game", { file: "a.pgn", n: 2, expectedIdentity: "captured" }],
    ]);
    vi.mocked(invoke).mockRejectedValueOnce("Source changed");
    await expect(pgnFiles.write("a.pgn", 2, "captured", "PGN", "{}")).rejects.toBe(
        "Source changed",
    );
});
