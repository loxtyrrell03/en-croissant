import useSWRImmutable from "swr/immutable";
import { commands } from "@/bindings";

/** Existing native UCI inspection is path-cached and bounded by its 15s timeout.
 * It reads options, without starting an analysis search. */
export function useNativeEngineConfig(path: string) {
    return useSWRImmutable(
        ["engine-config", path],
        async ([, enginePath]) => {
            const result = await commands.getEngineConfig(enginePath);
            if (result.status === "error") throw new Error(result.error);
            return result.data;
        },
        { shouldRetryOnError: false },
    );
}
