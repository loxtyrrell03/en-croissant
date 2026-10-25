import { expect, it, vi } from "vitest";
import { searchPosition, getPlanExplorer } from "../db";
import type { LocalOptions } from "@/components/panels/database/DatabasePanel";
const io = vi.hoisted(() => ({
    search: vi.fn(async () => ({ status: "ok", data: [[], []] })),
    plans: vi.fn(async () => ({ status: "ok", data: {} })),
}));
vi.mock("@/bindings", () => ({
    commands: { searchPosition: io.search, getPlanExplorer: io.plans },
}));

it("sends the same inclusive custom bounds to native position and plan queries", async () => {
    const options: LocalOptions = {
        path: "synthetic.db3",
        fen: "fixture-fen",
        type: "exact",
        color: "black",
        player: null,
        playerName: "",
        result: "draw",
        start_date: "2000.01.01",
        dateRange: { period: "custom", since: "2026-09-03", until: "2026-10-25" },
    };
    await searchPosition(options, "date-position", { includeGames: false });
    await getPlanExplorer(options, 12, "date-plan");
    for (const mock of [io.search, io.plans]) {
        expect(mock.mock.calls[0]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    start_date: "2026.09.03",
                    end_date: "2026.10.25",
                    wanted_result: "draw",
                    position: { fen: "fixture-fen", type_: "exact" },
                }),
            ]),
        );
    }
    expect(options.start_date).toBe("2000.01.01");
});
