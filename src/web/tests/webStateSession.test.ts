// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWebState } from "../storage";
import { createWebStateSession, installWebStatePageLifecycle } from "../webStateSession";

const deferred = () => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const changed = (title: string) => ({
    ...createEmptyWebState(),
    board: { ...createEmptyWebState().board, sourceTitle: title },
});
afterEach(() => vi.useRealTimers());

describe("workspace save ownership", () => {
    it("retains a failed read and cannot overwrite it before explicit retry succeeds", async () => {
        const load = vi
            .fn()
            .mockRejectedValueOnce(new Error("Example storage denied"))
            .mockResolvedValue(changed("Existing game"));
        const save = vi.fn();
        const session = createWebStateSession({ load, save });
        const pending = session.load();
        expect(session.load()).toBe(pending);
        await pending;
        expect(session.getSnapshot()).toMatchObject({
            loaded: false,
            loadError: "Example storage denied",
        });
        session.setState(changed("Must not be written"));
        await expect(session.flush()).rejects.toThrow("Load the saved workspace");
        expect(save).not.toHaveBeenCalled();
        expect(session.canReload()).toBe(false);
        await session.load();
        expect(session.getSnapshot().state.board.sourceTitle).toBe("Existing game");
        expect(session.canReload()).toBe(true);
        expect(load).toHaveBeenCalledTimes(2);
    });
    it("serializes saves and commits the latest edits made during an earlier write", async () => {
        const first = deferred(),
            second = deferred();
        const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const session = createWebStateSession({ load: async () => createEmptyWebState(), save });
        await session.load();
        session.setState(changed("First"));
        const flush = session.flush();
        await Promise.resolve();
        session.setState(changed("Latest"));
        expect(session.flush()).toBe(flush);
        expect(session.getSnapshot().savedState?.board.sourceTitle).toBeNull();
        expect(save).toHaveBeenCalledTimes(1);
        first.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(save).toHaveBeenCalledTimes(2);
        expect(session.hasUnsavedChanges()).toBe(true);
        expect(session.getSnapshot().savedState?.board.sourceTitle).toBe("First");
        second.resolve();
        await flush;
        expect(session.getSnapshot().savedState?.board.sourceTitle).toBe("Latest");
        expect(session.hasUnsavedChanges()).toBe(false);
    });
    it("keeps failed edits and retries the newest state once while retaining the error during retry", async () => {
        vi.useFakeTimers();
        const retry = deferred();
        const save = vi
            .fn()
            .mockRejectedValueOnce(new Error("Example full disk"))
            .mockReturnValueOnce(retry.promise);
        const session = createWebStateSession({ load: async () => createEmptyWebState(), save });
        await session.load();
        session.setState(changed("Unsaved"));
        await expect(session.flush()).rejects.toThrow("full disk");
        session.setState(changed("Edited after failure"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(save).toHaveBeenCalledTimes(1);
        expect(session.canReload()).toBe(false);
        const pending = session.flush();
        expect(session.flush()).toBe(pending);
        expect(session.getSnapshot()).toMatchObject({
            saving: true,
            saveError: "Example full disk",
        });
        retry.resolve();
        await pending;
        expect(save).toHaveBeenLastCalledWith(changed("Edited after failure"));
        expect(session.getSnapshot()).toMatchObject({ saving: false, saveError: null });
        expect(session.canReload()).toBe(true);
    });
    it("saves the first edit after load and survives all view subscribers leaving", async () => {
        vi.useFakeTimers();
        const save = vi.fn().mockResolvedValue(undefined),
            load = vi.fn(async () => createEmptyWebState());
        const session = createWebStateSession({ load, save });
        const unsubscribe = session.subscribe(() => {});
        await session.load();
        session.setState(changed("Keep across remount"));
        unsubscribe();
        await vi.advanceTimersByTimeAsync(250);
        await session.load();
        expect(save).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot().savedState?.board.sourceTitle).toBe("Keep across remount");
    });
    it("owns a flush before publishing so a synchronous subscriber cannot start a second writer", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const session = createWebStateSession({ load: async () => createEmptyWebState(), save });
        await session.load();
        session.setState(changed("Single writer"));
        let joined: Promise<void> | undefined;
        session.subscribe(() => {
            if (session.getSnapshot().saving) joined = session.flush();
        });
        const pending = session.flush();
        expect(joined).toBe(pending);
        await pending;
        expect(save).toHaveBeenCalledTimes(1);
    });
    it("flushes on pagehide and warns on close only while edits remain unsaved", async () => {
        const pending = deferred(),
            save = vi.fn(() => pending.promise);
        const session = createWebStateSession({ load: async () => createEmptyWebState(), save });
        await session.load();
        const cleanup = installWebStatePageLifecycle(session);
        try {
            session.setState(changed("Pending"));
            const close = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(close);
            expect(close.defaultPrevented).toBe(true);
            window.dispatchEvent(new Event("pagehide"));
            await Promise.resolve();
            expect(save).toHaveBeenCalledTimes(1);
            pending.resolve();
            await session.flush();
            const savedClose = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(savedClose);
            expect(savedClose.defaultPrevented).toBe(false);
        } finally {
            cleanup();
        }
    });
});
