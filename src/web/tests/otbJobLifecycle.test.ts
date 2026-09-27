import { afterEach, describe, expect, it, vi } from "vitest";
import {
    cancelWebOtbImport,
    loadWebOtbImportJob,
    watchWebOtbImportJob,
    type WebOtbImportJob,
} from "../otbImport";

afterEach(() => vi.unstubAllGlobals());
const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const completed = (id: string) => ({
    id,
    status: "completed",
    artifactAvailable: true,
    gameCount: 1,
    request: { playerName: "Example Player", fromYear: 2024 },
});
const artifact = (jobId: string) => ({
    jobId,
    games: [{ id: "1", pgn: "1. e4 *" }],
    prepDatabase: null,
});

describe("PC OTB job observations", () => {
    it.each([
        null,
        {},
        { id: "job", status: "unknown" },
        { id: "other", status: "running" },
        { id: "job", status: "completed" },
        { id: "job", status: "running", request: { playerName: "Example", fromYear: "2024" } },
    ])("rejects an invalid or different job response %j", async (body) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(body)));
        await expect(loadWebOtbImportJob("job")).rejects.toThrow("invalid OTB search status");
    });

    it("rejects a cancellation reply for another job", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ id: "other", status: "failed" })));
        await expect(cancelWebOtbImport("job")).rejects.toThrow("invalid OTB search status");
    });

    it("distinguishes a compact completed status from its loaded artifact", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(reply(completed("job")))
                .mockResolvedValueOnce(reply(artifact("job"))),
        );
        await expect(loadWebOtbImportJob("job")).resolves.toMatchObject({
            artifactLoaded: true,
            gameCount: 1,
        });
    });

    it("does not publish an old running GET after Stop discovers completion", async () => {
        const id = "stop-completion-race";
        let resolveOld!: (response: ReturnType<typeof reply>) => void;
        const oldReply = new Promise<ReturnType<typeof reply>>((resolve) => {
            resolveOld = resolve;
        });
        let oldSignal: AbortSignal | undefined;
        let gets = 0;
        const fetchMock = vi.fn((url: string, init?: RequestInit) => {
            if (init?.method === "DELETE") return Promise.resolve(reply(completed(id)));
            if (String(url).endsWith("/artifact")) return Promise.resolve(reply(artifact(id)));
            if (gets++ === 0) {
                oldSignal = init?.signal ?? undefined;
                return oldReply;
            }
            return Promise.resolve(reply(completed(id)));
        });
        vi.stubGlobal("fetch", fetchMock);
        const observed: WebOtbImportJob[] = [],
            errors: unknown[] = [];
        const unsubscribe = watchWebOtbImportJob(
            id,
            (job) => observed.push(job),
            (error) => errors.push(error),
        );
        try {
            await cancelWebOtbImport(id);
            await vi.waitFor(() => expect(observed).toHaveLength(1));
            expect(observed[0]).toMatchObject({ status: "completed", artifactLoaded: true });
            expect(oldSignal?.aborted).toBe(true);
            resolveOld(reply({ id, status: "running" }));
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(observed).toHaveLength(1);
            expect(errors).toEqual([]);
        } finally {
            unsubscribe();
        }
    });

    it("keeps a replacement poll owned when an abandoned request rejects late", async () => {
        const id = "stop-pending-replacement";
        let rejectOld!: (error: Error) => void;
        let resolveNew!: (response: ReturnType<typeof reply>) => void;
        let gets = 0;
        vi.stubGlobal(
            "fetch",
            vi.fn((_url: string, init?: RequestInit) => {
                if (init?.method === "DELETE")
                    return Promise.resolve(
                        reply({ id, status: "failed", error: "Search stopped." }),
                    );
                return gets++ === 0
                    ? new Promise((_resolve, reject) => {
                          rejectOld = reject;
                      })
                    : new Promise((resolve) => {
                          resolveNew = resolve;
                      });
            }),
        );
        const observed: WebOtbImportJob[] = [],
            errors: unknown[] = [];
        const unsubscribe = watchWebOtbImportJob(
            id,
            (job) => observed.push(job),
            (error) => errors.push(error),
        );
        try {
            await cancelWebOtbImport(id);
            rejectOld(new Error("Old transport failed"));
            await new Promise((resolve) => setTimeout(resolve, 20));
            resolveNew(reply({ id, status: "failed", error: "Search stopped." }));
            await vi.waitFor(() => expect(observed).toHaveLength(1));
            expect(observed[0].status).toBe("failed");
            expect(errors).toEqual([]);
        } finally {
            unsubscribe();
        }
    });
});
