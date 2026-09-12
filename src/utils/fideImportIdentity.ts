import type { FidePlayer } from "./fidePlayer";

export type FidePlayerSearch = (query: string, signal?: AbortSignal) => Promise<FidePlayer[]>;

export async function resolveFideImportIdentity(
    name: string,
    id: string,
    selected: FidePlayer | null,
    search: FidePlayerSearch,
    signal: AbortSignal,
) {
    name = name.trim();
    id = id.trim();
    if (signal.aborted) throw signal.reason;
    if (selected) {
        if (selected.name !== name || String(selected.id) !== id) {
            throw new Error(
                "The name and FIDE ID no longer match the selected player. Select the player again.",
            );
        }
        return { name, id, player: selected };
    }
    const numericName = /^\d+$/.test(name);
    if (numericName && id && Number(name) !== Number(id)) {
        throw new Error("The two FIDE IDs differ. Enter one player identity before importing.");
    }
    const lookup = numericName ? name : id;
    if (lookup) {
        if (!/^\d+$/.test(lookup) || !Number.isSafeInteger(Number(lookup)) || Number(lookup) <= 0) {
            throw new Error("Enter a valid FIDE ID or clear the ID to search by full name.");
        }
        const matches = await search(lookup, signal);
        if (signal.aborted) throw signal.reason;
        const player = matches.find((candidate) => candidate.id === Number(lookup));
        if (!player)
            throw new Error(
                "No player was found for that FIDE ID. Check the ID or search by full name.",
            );
        return { name: player.name, id: String(player.id), player };
    }
    // A full-name import is supported without the public mirror. Optional ID
    // enrichment may fail, but must never guess between identical names.
    let matches: FidePlayer[] = [];
    if (name) {
        try {
            matches = await search(name, signal);
        } catch (error) {
            if (signal.aborted) throw error;
        }
    }
    if (signal.aborted) throw signal.reason;
    const normalize = (value: string) =>
        value
            .toLocaleLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .trim();
    const exact = matches.filter((player) => normalize(player.name) === normalize(name));
    const player = exact.length === 1 ? exact[0] : null;
    return { name: player?.name ?? name, id: player ? String(player.id) : "", player };
}
