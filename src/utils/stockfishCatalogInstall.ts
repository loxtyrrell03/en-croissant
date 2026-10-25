import type { Engine } from "./engines";
import { stockfish19Profile } from "./stockfishDefaultUpgrade";

type Install = { path: string; version: string };
export type StockfishCatalogContext = {
    read(): Engine[] | undefined;
    write(profiles: Engine[]): void;
};
export type StockfishCatalogStatus = {
    phase:
        | "idle"
        | "checking"
        | "installing"
        | "cancelling"
        | "saving"
        | "complete"
        | "cancelled"
        | "error";
    id: string | null;
    path: string | null;
    error: string | null;
    pendingSave: boolean;
};
type IO = {
    directory(): Promise<string>;
    loadedDirectory(): string | undefined;
    saved(profiles: Engine[] | undefined): boolean;
    available(directory: string, profiles: Engine[]): Promise<Install | null>;
    install(id: string, directory: string): Promise<Install>;
    cancel(id: string): Promise<boolean>;
    flush(): Promise<void>;
    retrySave(): Promise<void>;
};
const pathKey = (path: string) => path.replaceAll("\\", "/").toLowerCase().replace(/\/$/, "");
export function hasStockfishCatalogPath(profiles: Engine[] | undefined, path: string | null) {
    return (
        !!path &&
        !!profiles?.some(
            (profile) => profile.type === "local" && pathKey(profile.path) === pathKey(path),
        )
    );
}
function append(profiles: Engine[], install: Install) {
    // Validation precedes identity matching; an unexpected native version cannot
    // be reported as success just because some saved profile has the same path.
    const profile = stockfish19Profile(install);
    if (hasStockfishCatalogPath(profiles, install.path)) return profiles;
    if (profiles.some((current) => current.id === profile.id)) profile.id = crypto.randomUUID();
    return [...profiles, profile];
}

/** A catalog operation outlives its dialog. Download completion does not mean
 * profile completion, and cancellation never releases ownership before the
 * native operation settles. Adding appends; it does not change an old default. */
export function createStockfishCatalogInstall(io: IO) {
    let status: StockfishCatalogStatus = {
        phase: "idle",
        id: null,
        path: null,
        error: null,
        pendingSave: false,
    };
    const listeners = new Set<() => void>();
    let running = false;
    let cancelled = false;
    let directory: string | null = null;
    const publish = (patch: Partial<StockfishCatalogStatus>) => {
        status = { ...status, ...patch };
        for (const listener of listeners) listener();
    };
    const ready = (context: StockfishCatalogContext) => {
        const profiles = context.read();
        if (!profiles || !io.saved(profiles))
            throw new Error("Load and save engine settings before adding Stockfish.");
        return profiles;
    };
    const sameDirectory = async () => {
        if ((await io.directory()) !== directory || io.loadedDirectory() !== directory)
            throw new Error(
                "The engine folder changed. Reload its saved profiles before adding an engine.",
            );
    };
    const fail = (error: unknown) =>
        publish({ phase: "error", error: error instanceof Error ? error.message : String(error) });
    return {
        getSnapshot: () => status,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        async add(context: StockfishCatalogContext) {
            if (running || status.pendingSave) return;
            running = true;
            cancelled = false;
            publish({
                phase: "checking",
                id: `stockfish19-${crypto.randomUUID()}`,
                path: null,
                error: null,
            });
            try {
                const initial = ready(context);
                directory = await io.directory();
                await sameDirectory();
                if (cancelled) return;
                let install = await io.available(directory, initial);
                if (cancelled) return;
                if (!install) {
                    publish({ phase: "installing" });
                    if (cancelled) return;
                    install = await io.install(status.id!, directory);
                }
                // A cancellation arriving as extraction commits keeps verified
                // files for reuse, but cannot add a profile after Cancel.
                if (cancelled) return;
                await sameDirectory();
                if (cancelled) return;
                const profiles = ready(context);
                const next = append(profiles, install);
                publish({ phase: "saving", path: install.path, pendingSave: true });
                if (next !== profiles) context.write(next);
                await io.flush();
                if (!io.saved(context.read()))
                    throw new Error("Engine settings have not finished saving.");
                publish({
                    phase: hasStockfishCatalogPath(context.read(), install.path)
                        ? "complete"
                        : "idle",
                    pendingSave: false,
                });
            } catch (error) {
                if (!cancelled) fail(error);
            } finally {
                if (cancelled) publish({ phase: "cancelled", error: null, pendingSave: false });
                running = false;
            }
        },
        async cancel() {
            if (!running || status.phase === "saving") return;
            const needsNative = status.phase === "installing" || status.phase === "cancelling";
            const id = status.id!;
            cancelled = true;
            publish({ phase: "cancelling", error: null });
            if (needsNative) {
                try {
                    await io.cancel(id);
                } catch (error) {
                    // The native promise still owns this request. Keep Cancel
                    // retryable and wait, rather than pretending it stopped.
                    if (running && status.id === id && status.phase === "cancelling")
                        publish({
                            error: `Cancellation could not be requested: ${error instanceof Error ? error.message : String(error)}. Retry Cancel; the file operation is still running.`,
                        });
                }
            }
        },
        async retrySave(context: StockfishCatalogContext) {
            if (running || !status.pendingSave) return;
            running = true;
            publish({ phase: "saving", error: null });
            try {
                await sameDirectory();
                if (!io.saved(context.read())) await io.retrySave();
                await io.flush();
                if (!io.saved(context.read()))
                    throw new Error("Engine settings have not finished saving.");
                publish({
                    phase: hasStockfishCatalogPath(context.read(), status.path)
                        ? "complete"
                        : "idle",
                    pendingSave: false,
                });
            } catch (error) {
                fail(error);
            } finally {
                running = false;
            }
        },
    };
}
