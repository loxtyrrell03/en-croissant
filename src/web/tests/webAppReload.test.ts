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
