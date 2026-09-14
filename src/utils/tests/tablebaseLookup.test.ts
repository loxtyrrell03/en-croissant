import { afterEach, expect, test, vi } from "vitest";
import { lookupTacticalEndgameEvidence } from "../tacticalMotifs/tablebaseLookup";
import { tablebaseCases } from "./fixtures/tablebaseRelevance";

const row = tablebaseCases.find((r) => r.id === "EKWHC:g4f4")!;
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
const body = (index: number) => JSON.stringify(row.evidence.records[index].result);

test("an explicit lookup sends only two exact positions, with no cookies or referrer", async () => {
    const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response(body(0)))
        .mockResolvedValueOnce(new Response(body(1)));
    vi.stubGlobal("fetch", fetcher);
    const result = await lookupTacticalEndgameEvidence(row.fen, row.move, new AbortController().signal);
    expect(result).toEqual(row.evidence);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 2; index++) {
        const [url, options] = fetcher.mock.calls[index];
        expect(new URL(url).searchParams.get("fen")).toBe(row.evidence.records[index].fen);
        expect(options).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    }
});

test.each(["http", "missing", "uncertain", "malformed", "oversized"])(
    "%s failures stop immediately and never create a no-tactic result",
    async (kind) => {
        const raw = structuredClone(row.evidence.records[0].result) as {
            category: string;
            moves: unknown[];
        };
        if (kind === "missing") raw.moves.pop();
        if (kind === "uncertain") raw.category = "maybe-loss";
        const response =
            kind === "http"
                ? new Response("slow down", { status: 429 })
                : new Response(
                      kind === "malformed"
                          ? "{"
                          : kind === "oversized"
                            ? "x".repeat(128001)
                            : JSON.stringify(raw),
                  );
        const fetcher = vi.fn().mockResolvedValue(response);
        vi.stubGlobal("fetch", fetcher);
        await expect(
            lookupTacticalEndgameEvidence(row.fen, row.move, new AbortController().signal),
        ).rejects.toThrow(/Lichess|JSON|endgame|Expected/);
        expect(fetcher).toHaveBeenCalledTimes(1);
    },
);

test.each(["timeout", "cancel"])(
    "a stalled %s ends the lookup without starting its second request",
    async (kind) => {
        vi.useFakeTimers();
        const fetcher = vi.fn(
            (_url, options) =>
                new Promise((_resolve, reject) =>
                    options.signal.addEventListener("abort", () => reject(options.signal.reason), {
                        once: true,
                    }),
                ),
        );
        vi.stubGlobal("fetch", fetcher);
        const controller = new AbortController();
        const done = lookupTacticalEndgameEvidence(row.fen, row.move, controller.signal).catch(
            (error) => error,
        );
        if (kind === "cancel") controller.abort();
        else await vi.advanceTimersByTimeAsync(8000);
        expect((await done).message).toMatch(/timed out|aborted/i);
        expect(fetcher).toHaveBeenCalledTimes(1);
    },
);

test("an already cancelled or ineligible request does not contact the service", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(lookupTacticalEndgameEvidence(row.fen, row.move, controller.signal)).rejects.toThrow(
        /aborted/i,
    );
    await expect(
        lookupTacticalEndgameEvidence(row.fen, "a1a8", new AbortController().signal),
    ).rejects.toThrow("not eligible");
    expect(fetcher).not.toHaveBeenCalled();
});
