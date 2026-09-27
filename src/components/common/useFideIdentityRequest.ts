import { useEffect, useMemo, useRef } from "react";

/** Owns autofill/preflight reads; an edit, a new read or unmount abandons the old identity. */
export function useFideIdentityRequest() {
    const current = useRef<AbortController | null>(null);
    useEffect(() => () => current.current?.abort(), []);
    return useMemo(
        () => ({
            begin() {
                current.current?.abort();
                const controller = new AbortController();
                current.current = controller;
                return controller;
            },
            cancel() {
                current.current?.abort();
            },
        }),
        [],
    );
}
