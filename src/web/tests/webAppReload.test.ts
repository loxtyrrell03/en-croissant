// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installWebAppLifecycle } from "../webAppLifecycle";
import { createWebStateSession } from "../webStateSession";
import { createEmptyWebState } from "../storage";

afterEach(() => {
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
});
function browserFixture() {
    const browser = new EventTarget(),
        worker = new EventTarget();
    const reload = vi.fn();
    const storage = new Map<string, string>();
    Object.assign(browser, {
        location: { reload },
        sessionStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        },
    });
    Object.assign(worker, { register: async () => ({ update: async () => {} }) });
    vi.stubGlobal("window", browser);
    vi.stubGlobal("navigator", { serviceWorker: worker });
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ sourceCommit: "new-build" })),
    );
    document.head.innerHTML = '<meta name="en-croissant-build" content="old-build">';
    return { worker, reload, storage };
}
const settle = async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
};
describe("phone update reload", () => {
    it("detects an update even when worker registration never completes, without reloading an active app", async () => {
        const fixture = browserFixture();
        Object.assign(fixture.worker, { register: () => new Promise(() => {}) });
        const onUpdate = vi.fn();
        let saved = false;
        const controller = installWebAppLifecycle("/", () => saved, {
            autoReload: false,
            onUpdate,
        });
        try {
            await settle();
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(onUpdate).toHaveBeenLastCalledWith({
                current: "old-build",
                latest: "new-build",
                available: true,
            });
            expect(fixture.reload).not.toHaveBeenCalled();
            expect(controller.apply(true)).toBe(false);
            saved = true;
            expect(controller.apply(true)).toBe(true);
            expect(fixture.reload).toHaveBeenCalledTimes(1);
        } finally {
            controller();
        }
    });

    it("checks a newly published build while an installed window stays open", async () => {
        vi.useFakeTimers();
        const fixture = browserFixture();
        const read = vi.fn(async () => Response.json({ sourceCommit: "old-build" }));
        vi.stubGlobal("fetch", read);
        const onUpdate = vi.fn();
        const controller = installWebAppLifecycle("/", () => true, { autoReload: false, onUpdate });
        try {
            await settle();
            expect(read).toHaveBeenCalledTimes(1);
            read.mockImplementation(async () => Response.json({ sourceCommit: "new-build" }));
            await vi.advanceTimersByTimeAsync(30_000);
            expect(read).toHaveBeenCalledTimes(2);
            expect(onUpdate.mock.lastCall?.[0].available).toBe(true);
            expect(fixture.reload).not.toHaveBeenCalled();
        } finally {
            controller();
            vi.useRealTimers();
        }
    });
    it("defers a new build through loading, pending and failed saves; allows reload after retry", async () => {
        const fixture = browserFixture();
        let fail = true;
        const session = createWebStateSession({
            load: async () => createEmptyWebState(),
            save: async () => {
                if (fail) throw Error("Example full disk");
            },
        });
        const cleanup = installWebAppLifecycle("/", session.canReload);
        try {
            await settle();
            expect(fixture.reload).not.toHaveBeenCalled();
            expect(fixture.storage.size).toBe(0);
            await session.load();
            session.setState((state) => ({ ...state, activePrepId: "Pending" }));
            fixture.worker.dispatchEvent(new Event("controllerchange"));
            await settle();
            expect(fixture.reload).not.toHaveBeenCalled();
            await expect(session.flush()).rejects.toThrow("full disk");
            fixture.worker.dispatchEvent(new Event("controllerchange"));
            await settle();
            expect(fixture.reload).not.toHaveBeenCalled();
            expect(fixture.storage.size).toBe(0);
            fail = false;
            await session.flush();
            fixture.worker.dispatchEvent(new Event("controllerchange"));
            await settle();
            expect(fixture.reload).toHaveBeenCalledTimes(1);
            expect(fixture.storage.size).toBe(1);
        } finally {
            cleanup();
        }
    });
    it("does not reload a disposed root after a delayed version reply", async () => {
        const fixture = browserFixture();
        let resolve!: (value: Response) => void;
        vi.stubGlobal(
            "fetch",
            vi.fn(
                () =>
                    new Promise<Response>((yes) => {
                        resolve = yes;
                    }),
            ),
        );
        const cleanup = installWebAppLifecycle("/");
        await settle();
        cleanup();
        resolve(Response.json({ sourceCommit: "new-build" }));
        await settle();
        expect(fixture.reload).not.toHaveBeenCalled();
        expect(fixture.storage.size).toBe(0);
    });
});
