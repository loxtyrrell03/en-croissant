import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createVerifiedJsonPreference } from "./verifiedJsonPreference";
export const VERIFIED_PHONE_PREFERENCE_CHANGED = "en-croissant-verified-phone-preference";
const unfinishedPreferences = new Map<string, unknown>();
export function useVerifiedJsonPreference<T extends object>(
    key: string,
    fallback: T,
    normalize: (value: Partial<T> | null) => T,
    suppliedStore?: ReturnType<typeof createVerifiedJsonPreference<T>>,
) {
    const ref = useRef<ReturnType<typeof createVerifiedJsonPreference<T>> | null>(null);
    if (!ref.current && suppliedStore) ref.current = suppliedStore;
    if (!ref.current && unfinishedPreferences.has(key))
        ref.current = unfinishedPreferences.get(key) as ReturnType<
            typeof createVerifiedJsonPreference<T>
        >;
    if (!ref.current)
        ref.current = createVerifiedJsonPreference({
            fallback,
            normalize,
            read: () => localStorage.getItem(key),
            write: (text) => localStorage.setItem(key, text),
            remove: () => localStorage.removeItem(key),
            changed: () =>
                window.dispatchEvent(
                    new CustomEvent(VERIFIED_PHONE_PREFERENCE_CHANGED, { detail: key }),
                ),
        });
    const store = ref.current;
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    useEffect(
        () => () => {
            if (store.getSnapshot().pending) unfinishedPreferences.set(key, store);
            else unfinishedPreferences.delete(key);
        },
        [key, store],
    );
    useEffect(() => {
        const storage = (event: StorageEvent) => {
            if (event.key === key || event.key === null) store.reload();
        };
        const samePage = (event: Event) => {
            if ((event as CustomEvent).detail === key) store.reload();
        };
        window.addEventListener("storage", storage);
        window.addEventListener(VERIFIED_PHONE_PREFERENCE_CHANGED, samePage);
        return () => {
            window.removeEventListener("storage", storage);
            window.removeEventListener(VERIFIED_PHONE_PREFERENCE_CHANGED, samePage);
        };
    }, [key, store]);
    const set = useCallback(
        (update: (current: T) => T) => {
            store.update(update);
        },
        [store],
    );
    return [snapshot.value, set, snapshot.error, store.retry, store, snapshot] as const;
}
