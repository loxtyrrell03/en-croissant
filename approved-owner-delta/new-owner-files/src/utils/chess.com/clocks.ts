export function parseChessComMoveClocks(value?: string | null): number[] {
    if (!value) return [];

    return value
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((clock) => Number.isFinite(clock))
        .map((clock) => clock / 10);
}

export function formatChessComClock(seconds: number): string {
    const safeSeconds = Math.max(0, seconds);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const remaining = safeSeconds % 60;
    const secondText = remaining.toLocaleString("en", {
        minimumIntegerDigits: 2,
        maximumFractionDigits: 3,
    });

    return `${hours}:${minutes.toString().padStart(2, "0")}:${secondText}`;
}

export function makeChessComClockComment(seconds?: number): string | undefined {
    if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
    return `[%clk ${formatChessComClock(seconds)}]`;
}
