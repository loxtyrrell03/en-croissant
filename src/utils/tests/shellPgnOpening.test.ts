import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    take: vi.fn(),
    listen: vi.fn(),
    open: vi.fn(),
    show: vi.fn(),
    warn: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.take }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-log", () => ({ warn: mocks.warn }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: mocks.show } }));
vi.mock("../files", () => ({ openFile: mocks.open }));

let callback: (() => void) | undefined;
let cleanups: (() => void)[] = [];
const setTabs = vi.fn(),
    setActive = vi.fn();
const tick = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
async function install() {
    const { installNativePgnOpening } = await import("../shellPgnOpening");
    const stop = installNativePgnOpening(setTabs, setActive);
    cleanups.push(stop);
    return stop;
}
beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    callback = undefined;
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    mocks.take.mockResolvedValue([]);
    mocks.open.mockResolvedValue("new-tab");
    mocks.warn.mockResolvedValue(undefined);
    mocks.listen.mockImplementation(async (_name, listener) => {
        callback = listener;
        return () => {
            if (callback === listener) callback = undefined;
        };
    });
});
afterEach(() => {
    cleanups.forEach((stop) => stop());
    cleanups = [];
    vi.unstubAllGlobals();
});

it("subscribes before taking startup paths and retains a concurrent notification", async () => {
    const native = ["first.pgn"];
    mocks.take.mockImplementation(async (command) => {
        expect(command).toBe("take_shell_open_paths");
        expect(callback).toBeTypeOf("function");
        const batch = native.splice(0);
        if (batch.includes("first.pgn")) {
            native.push("second.pgn");
            callback!();
        }
        return batch;
    });
    await install();
    await tick();
    expect(mocks.listen).toHaveBeenCalledExactlyOnceWith(
        "shell://open-paths",
        expect.any(Function),
    );
    expect(mocks.open.mock.calls.map((call) => call[0])).toEqual(["first.pgn", "second.pgn"]);
    expect(mocks.open.mock.calls[0].slice(1, 3)).toEqual([setTabs, setActive]);
});

it("serializes native batches while a protected opening is in flight", async () => {
    const first = deferred<string>();
    mocks.take
        .mockResolvedValueOnce(["first.pgn", "second.pgn"])
        .mockResolvedValueOnce(["third.pgn"]);
    mocks.open.mockImplementationOnce(() => first.promise);
    await install();
    await tick();
    callback!();
    await tick();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    first.resolve("first-tab");
    await tick();
    expect(mocks.open.mock.calls.map((call) => call[0])).toEqual([
        "first.pgn",
        "second.pgn",
        "third.pgn",
    ]);
});

it("aborts an obsolete read and retains that request and remaining batch for remount", async () => {
    const first = deferred<void>();
    const commits: string[] = [];
    mocks.take.mockResolvedValueOnce(["first.pgn", "second.pgn"]);
    mocks.open.mockImplementation(async (path, _tabs, _active, options) => {
        if (!commits.length && mocks.open.mock.calls.length === 1) await first.promise;
        options.signal.throwIfAborted();
        commits.push(path);
        return "new-tab";
    });
    const stop = await install();
    await tick();
    stop();
    expect(mocks.open.mock.calls[0][3].signal.aborted).toBe(true);
    await install();
    first.resolve();
    await tick();
    expect(commits).toEqual(["first.pgn", "second.pgn"]);
    expect(mocks.open).toHaveBeenCalledTimes(3);
    expect(mocks.show).not.toHaveBeenCalled();
});

it("retains a batch returned after IPC ownership was disposed", async () => {
    const batch = deferred<string[]>();
    mocks.take.mockImplementationOnce(() => batch.promise);
    const stop = await install();
    await tick();
    stop();
    await install();
    batch.resolve(["late.pgn"]);
    await tick();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open.mock.calls[0][0]).toBe("late.pgn");
    expect(mocks.open.mock.calls[0][3].signal.aborted).toBe(false);
});

it("cleans a late subscription without draining files into an obsolete root", async () => {
    const subscription = deferred<() => void>();
    const unlisten = vi.fn();
    mocks.listen.mockImplementationOnce(() => subscription.promise);
    const stop = await install();
    stop();
    subscription.resolve(unlisten);
    await tick();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(mocks.take).not.toHaveBeenCalled();
});

it("shows a failed file and continues opening the rest through the protected reader", async () => {
    mocks.take.mockResolvedValueOnce(["bad.pgn", "good.pgn"]);
    mocks.open.mockRejectedValueOnce(new Error("Source unavailable"));
    await install();
    await tick();
    expect(mocks.open.mock.calls.map((call) => call[0])).toEqual(["bad.pgn", "good.pgn"]);
    expect(mocks.show).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
            title: "Could not open PGN",
            message: "bad.pgn: Error: Source unavailable",
        }),
    );
});

it("retries a native queue read after a later shell notification", async () => {
    mocks.take
        .mockRejectedValueOnce(new Error("IPC unavailable"))
        .mockResolvedValueOnce(["retained.pgn"]);
    await install();
    await tick();
    expect(mocks.open).not.toHaveBeenCalled();
    callback!();
    await tick();
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.show).toHaveBeenCalledOnce();
});

it("does not duplicate a tab committed immediately before root cleanup", async () => {
    mocks.take.mockResolvedValueOnce(["committed.pgn"]);
    let stop!: () => void;
    mocks.open.mockImplementationOnce(async () => {
        stop();
        return "committed-tab";
    });
    stop = await install();
    await tick();
    await install();
    await tick();
    expect(mocks.open).toHaveBeenCalledOnce();
});

it("keeps native paths retained if event subscription fails", async () => {
    mocks.listen.mockRejectedValueOnce(new Error("Events unavailable"));
    await install();
    await tick();
    expect(mocks.take).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledOnce();
});

it("does not subscribe or consume native requests in a browser session", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", undefined);
    await install();
    await tick();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.take).not.toHaveBeenCalled();
});
