export type PgnGameListEntry = { name: string; identity: string; sourceKey: string };
export function pgnGameListKey(path: string, version: string | number, total: number) {
    return JSON.stringify([path, version, total]);
}
