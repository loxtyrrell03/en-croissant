import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getHostedDatabaseFolders, getHostedWebLibrary, type WebHostedLibrary } from "./hostedFiles";

export function useHostedDatabaseFolders() {
    const [library, setLibrary] = useState<WebHostedLibrary | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const generation = useRef(0);
    const load = useCallback(async (forceRefresh = false) => {
        const request = ++generation.current;
        setLoading(true); setError(null);
        try {
            const next = await getHostedWebLibrary({ forceRefresh });
            if (!next.available || !next.manifest) throw new Error("The PC database list is unavailable.");
            if (request === generation.current) setLibrary(next);
        } catch (cause) {
            if (request === generation.current) setError(cause instanceof Error ? cause.message : "The PC database list did not load.");
            throw cause;
        } finally {
            if (request === generation.current) setLoading(false);
        }
    }, []);
    useEffect(() => {
        void load().catch(() => {});
        // Invalidate whichever async request is current when the hook unmounts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        return () => { generation.current++; };
    }, [load]);
    const folders = useMemo(() => library ? getHostedDatabaseFolders(library) : [], [library]);
    const refresh = useCallback(() => load(true), [load]);
    return { library, folders, loading, error, refresh };
}
