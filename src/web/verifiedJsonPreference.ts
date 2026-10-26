export type BrowserPreferenceEdit = {
    save: () => void;
    restore: () => void;
    owns: () => boolean;
    isApplied: () => boolean;
};
/** Save-first browser preferences. Reads never write defaults. Edits own only
 * their changed fields, so retry/restore preserves newer independent choices. */
export function createVerifiedJsonPreference<T extends object>(options: {
    fallback: T;
    normalize: (value: Partial<T> | null) => T;
    read: () => string | null;
    write: (text: string) => void;
    remove?: () => void;
    changed?: () => void;
}) {
    const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    let revision = 0,
        observedExisting = false,
        userEdited = false,
        loaded = false;
    let raw: string | null = null;
    let failed: { edit: BrowserPreferenceEdit | null; message: string } | null = null;
    let snapshot = {
        value: Object.freeze(options.normalize(options.fallback)) as T,
        phase: "unreadable" as "unreadable" | "missing" | "ready",
        error: null as string | null,
        revision,
        firstUseEligible: false,
        pending: false,
    };
    const versions = new Map<string, number>(),
        listeners = new Set<() => void>();
    function notify() {
        snapshot = {
            ...snapshot,
            error: failed?.message ?? null,
            revision,
            firstUseEligible: loaded && raw === null && !observedExisting && !userEdited,
            pending: failed?.edit != null,
        };
        for (const listener of listeners) listener();
    }
    function read() {
        const text = options.read();
        observedExisting ||= text !== null;
        const object = text === null ? null : JSON.parse(text);
        if (object !== null && (typeof object !== "object" || Array.isArray(object)))
            throw Error("Saved engine settings are not a settings object.");
        return {
            text,
            object: object as Partial<T> | null,
            value: options.normalize(text === null ? options.fallback : object),
        };
    }
    function adopt(value: ReturnType<typeof read>, ignore: string[] = []) {
        const fields = { ...value.value };
        for (const key of Object.keys(fields) as (keyof T & string)[]) {
            if (equal(fields[key], snapshot.value[key])) fields[key] = snapshot.value[key];
            else if (!ignore.includes(key)) versions.set(key, (versions.get(key) ?? 0) + 1);
        }
        if (raw !== value.text) revision++;
        raw = value.text;
        loaded = true;
        snapshot = {
            ...snapshot,
            value: Object.freeze(fields),
            phase: raw === null ? "missing" : "ready",
        };
        notify();
    }
    function fail(error: unknown, edit: BrowserPreferenceEdit | null, reading = false) {
        failed = { edit, message: error instanceof Error ? error.message : String(error) };
        if (reading) snapshot = { ...snapshot, phase: "unreadable" };
        notify();
    }
    function reload() {
        try {
            const fresh = read();
            failed = null;
            adopt(fresh);
            return true;
        } catch {
            fail(
                new Error("Could not read engine settings. Saved choices were preserved."),
                null,
                true,
            );
            return false;
        }
    }
    function prepare(
        update: (current: T) => T,
        guard: () => boolean = () => true,
        initializing = false,
    ): BrowserPreferenceEdit {
        let before: ReturnType<typeof read>;
        try {
            before = read();
            adopt(before);
        } catch {
            fail(
                new Error("Could not read engine settings. Saved choices were preserved."),
                null,
                true,
            );
            throw Error(snapshot.error!);
        }
        if (initializing && !snapshot.firstUseEligible)
            throw Error("Existing engine preferences are not first-use settings.");
        const target = options.normalize(update(snapshot.value));
        const keys = (Object.keys(target) as (keyof T & string)[]).filter(
            (key) => !equal(target[key], before.value[key]),
        );
        const tokens = new Map<string, number>();
        for (const key of keys) {
            const token = (versions.get(key) ?? 0) + 1;
            versions.set(key, token);
            tokens.set(key, token);
        }
        if (keys.length && !initializing) userEdited = true;
        if (failed?.edit && !failed.edit.owns()) failed = null;
        revision++;
        notify();
        let written: string | null = null;
        const owns = () =>
            guard() &&
            (!initializing || !userEdited) &&
            keys.every((key) => versions.get(key) === tokens.get(key));
        function check(value: ReturnType<typeof read>) {
            if (
                !owns() ||
                (initializing && (userEdited || (value.text !== null && value.text !== written))) ||
                !keys.every(
                    (key) =>
                        equal(value.value[key], before.value[key]) ||
                        equal(value.value[key], target[key]),
                )
            ) {
                adopt(value);
                throw Error(
                    "Newer engine settings replaced this edit. Current choices were preserved.",
                );
            }
        }
        function finish(restoring: boolean) {
            try {
                const current = read();
                check(current);
                adopt(current, keys);
                if (
                    restoring &&
                    keys.every((key) => equal(current.value[key], before.value[key]))
                ) {
                    userEdited = true;
                    if (failed?.edit === edit) failed = null;
                    notify();
                    return;
                }
                if (keys.length) {
                    if (
                        restoring &&
                        before.text === null &&
                        written !== null &&
                        current.text === written &&
                        options.remove
                    ) {
                        options.remove();
                        if (options.read() !== null)
                            throw Error("The previous engine settings could not be restored.");
                        userEdited = true;
                        if (failed?.edit === edit) failed = null;
                        adopt(read(), keys);
                        options.changed?.();
                        return;
                    }
                    const patch = Object.fromEntries(
                        keys.map((key) => [key, restoring ? before.value[key] : target[key]]),
                    );
                    const text = JSON.stringify({
                        ...(current.text === null ? current.value : current.object),
                        ...patch,
                    });
                    if (!owns()) throw Error("This engine changed. Its settings were preserved.");
                    if (text !== current.text) {
                        written = text;
                        options.write(text);
                    }
                    if (options.read() !== text)
                        throw Error(
                            "The engine settings save could not be verified. Retry or restore the previous choices.",
                        );
                    const verified = read();
                    if (verified.text !== text || !owns())
                        throw Error(
                            "Engine settings changed during verification. Current choices were preserved.",
                        );
                    if (initializing && !restoring) userEdited = true;
                    if (failed?.edit === edit) failed = null;
                    adopt(verified, keys);
                    options.changed?.();
                } else if (failed?.edit === edit) {
                    failed = null;
                    notify();
                }
            } catch (error) {
                fail(error, edit);
                throw error;
            }
        }
        const edit: BrowserPreferenceEdit = {
            owns,
            save: () => finish(false),
            restore: () => finish(true),
            isApplied: () =>
                snapshot.phase === "ready" &&
                !snapshot.error &&
                keys.every((key) => equal(snapshot.value[key], target[key])),
        };
        return edit;
    }
    reload();
    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        prepare,
        reload,
        update(update: (current: T) => T) {
            try {
                prepare(update).save();
                return true;
            } catch {
                return false;
            }
        },
        retry() {
            if (!failed?.edit || !failed.edit.owns()) return reload();
            try {
                failed.edit.save();
                return true;
            } catch {
                return false;
            }
        },
    };
}
