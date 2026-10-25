import { MANAGED_LC0_ID, type Engine, type LocalEngine } from "./engines";

export type CatalogFiles = { path: string; weightsPath?: string | null };
export type CatalogContext = { read(): Engine[] | undefined; write(value: Engine[]): void };
export type CatalogStatus = {
    phase: "idle" | "checking" | "installing" | "validating" | "saving" | "complete" | "error";
    id: string | null;
    path: string | null;
    error: string | null;
    pendingSave: boolean;
};
type IO = {
    directory(): Promise<string>;
    loadedDirectory(): string | undefined;
    saved(profiles: Engine[] | undefined): boolean;
    download(id: string, directory: string): Promise<CatalogFiles>;
    validate(files: CatalogFiles): Promise<LocalEngine>;
    flush(): Promise<void>;
    retrySave(): Promise<void>;
};

const windowsPath = (path: string) => /^[a-z]:[\\/]|^[/\\]{2}/i.test(path);
const pathKey = (path: string) => {
    const value = path.replaceAll("\\", "/").replace(/\/$/, "");
    return windowsPath(path) ? value.toLowerCase() : value;
};
export function catalogInstallKey(engine: LocalEngine) {
    return JSON.stringify([
        engine.managedInstall ?? null,
        engine.downloadLink ?? null,
        engine.path,
        engine.version,
    ]);
}
export function profileAtCatalogPath(profiles: Engine[] | undefined, path: string | null) {
    return path
        ? profiles?.find(
              (profile) => profile.type === "local" && pathKey(profile.path) === pathKey(path),
          )
        : undefined;
}
/** A shared name alone is not an installation receipt. Preserve manual profiles. */
export function catalogProfile(
    profiles: Engine[] | undefined,
    engine: LocalEngine,
    path: string | null,
) {
    if (path) return profileAtCatalogPath(profiles, path);
    return profiles?.find(
        (profile) =>
            profile.type === "local" &&
            profile.version === engine.version &&
            (engine.managedInstall
                ? (profile.managedInstall === engine.managedInstall ||
                      profile.id === MANAGED_LC0_ID) &&
                  profile.path.split(/[\\/]/).at(-1)?.toLowerCase() ===
                      engine.path.split(/[\\/]/).at(-1)?.toLowerCase()
                : !!engine.downloadLink &&
                  profile.downloadLink === engine.downloadLink &&
                  pathKey(profile.path).endsWith(
                      "/" +
                          (windowsPath(profile.path)
                              ? pathKey(engine.path).toLowerCase()
                              : pathKey(engine.path)
                          ).replace(/^\/+/, ""),
                  )),
    );
}

/** File work survives its dialog. Only a validated, durably saved profile completes it. */
export function createCatalogInstall(io: IO) {
    let status: CatalogStatus = {
        phase: "idle",
        id: null,
        path: null,
        error: null,
        pendingSave: false,
    };
    let running = false;
    let directory: string | undefined;
    let files: CatalogFiles | null = null;
    const listeners = new Set<() => void>();
    const publish = (patch: Partial<CatalogStatus>) => {
        status = { ...status, ...patch };
        for (const listener of listeners) listener();
    };
    const ready = (context: CatalogContext) => {
        const value = context.read();
        if (!value || !io.saved(value))
            throw new Error("Load and save engine settings before installing an engine.");
        return value;
    };
    const sameDirectory = async () => {
        if ((await io.directory()) !== directory || io.loadedDirectory() !== directory)
            throw new Error(
                "The engine folder changed. Reload its saved profiles before installing an engine.",
            );
    };
    const fail = (error: unknown) =>
        publish({ phase: "error", error: error instanceof Error ? error.message : String(error) });
    const saved = (context: CatalogContext) => {
        if (!io.saved(context.read())) throw new Error("Engine settings have not finished saving.");
        publish({
            phase: profileAtCatalogPath(context.read(), status.path) ? "complete" : "idle",
            pendingSave: false,
        });
    };
    return {
        getSnapshot: () => status,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        async install(context: CatalogContext) {
            if (running || status.pendingSave) return;
            running = true;
            const reuseFiles = status.phase === "error";
            publish({ phase: "checking", error: null });
            try {
                ready(context);
                const selected = await io.directory();
                if (!reuseFiles || directory !== selected) files = null;
                directory = selected;
                await sameDirectory();
                if (!files) {
                    publish({
                        phase: "installing",
                        id: `engine-install-${crypto.randomUUID()}`,
                        path: null,
                    });
                    files = await io.download(status.id!, directory);
                }
                await sameDirectory();
                publish({ phase: "validating", path: files.path });
                const profile = await io.validate(files);
                // Other completed installs/owner edits may have saved while the
                // native work ran. Read the latest model only after settlement.
                await io.flush();
                await sameDirectory();
                const current = ready(context);
                const present = profileAtCatalogPath(current, files.path);
                if (current.some((entry) => entry.id === profile.id))
                    profile.id = crypto.randomUUID();
                publish({ phase: "saving", pendingSave: true });
                if (!present) context.write([...current, profile]);
                await io.flush();
                await sameDirectory();
                saved(context);
            } catch (error) {
                fail(error);
            } finally {
                running = false;
            }
        },
        async retrySave(context: CatalogContext) {
            if (running || !status.pendingSave) return;
            running = true;
            publish({ phase: "saving", error: null });
            try {
                await sameDirectory();
                if (!io.saved(context.read())) await io.retrySave();
                await io.flush();
                await sameDirectory();
                saved(context);
            } catch (error) {
                fail(error);
            } finally {
                running = false;
            }
        },
        async confirmSaved(context: CatalogContext) {
            if (running || !status.pendingSave || !io.saved(context.read())) return;
            running = true;
            try {
                await sameDirectory();
                if (io.saved(context.read())) saved(context);
            } catch (error) {
                fail(error);
            } finally {
                running = false;
            }
        },
    };
}
