export const LC0_NETWORK_PROFILES = [
    { value: "none", label: "Standard (BT4)", displayName: "Standard strength", family: "BT4" },
    { value: "knight", label: "Knight odds (T1)", displayName: "Knight odds", family: "T1" },
    { value: "rook", label: "Rook odds (T1)", displayName: "Rook odds", family: "T1" },
    {
        value: "double_knight",
        label: "Double knight odds (T1)",
        displayName: "Double-knight odds",
        family: "T1",
    },
    {
        value: "rook_and_knight",
        label: "Rook + knight odds (T1)",
        displayName: "Rook-and-knight odds",
        family: "T1",
    },
    {
        value: "queen_for_knight",
        label: "Queen for knight odds (T1)",
        displayName: "Queen-for-knight odds",
        family: "T1",
    },
    { value: "queen", label: "Queen odds (LQO)", displayName: "Queen odds", family: "LQO" },
] as const;

export type Lc0NetworkProfile = (typeof LC0_NETWORK_PROFILES)[number]["value"];
export type PcEngineKind = "stockfish" | "lc0";

const LC0_NETWORK_VALUES = new Set<string>(LC0_NETWORK_PROFILES.map((profile) => profile.value));

export function normalizeLc0NetworkProfile(value: unknown): Lc0NetworkProfile {
    const normalized = String(value ?? "none")
        .trim()
        .toLowerCase();
    return LC0_NETWORK_VALUES.has(normalized) ? (normalized as Lc0NetworkProfile) : "none";
}

export function getLc0NetworkDisplayName(value: unknown) {
    const normalized = normalizeLc0NetworkProfile(value);
    return (
        LC0_NETWORK_PROFILES.find((profile) => profile.value === normalized)?.displayName ??
        "Standard strength"
    );
}
