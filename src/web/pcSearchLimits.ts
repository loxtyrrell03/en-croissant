import {
    ENGINE_SEARCH_PROTOCOL_VERSION,
    captureEngineSearchLimit,
    engineSearchCommand,
    type EngineSearchLimit,
} from "../../scripts/engine-search-protocol.mjs";
import type { PcEngineKind } from "@/utils/lc0Networks";
import { loadPcEngineHealth, PcEngineCapabilityError } from "./pcEngineHealth";

export class PcSearchProtocolError extends PcEngineCapabilityError {}
export type PcSearchCapability = {
    depth: { min: number; max: number };
    timeMs: { min: number; max: number };
    nodes: { min: number; max: number };
    infinite: true;
};
export function capturePcSearchLimit(value: unknown): EngineSearchLimit {
    try {
        return captureEngineSearchLimit(value);
    } catch {
        throw new PcSearchProtocolError(
            "The saved search limit is invalid. Choose a supported limit.",
        );
    }
}
export function parsePcSearchCapability(value: unknown): PcSearchCapability {
    const health = value as {
        searchProtocolVersion?: unknown;
        searchLimits?: PcSearchCapability;
    } | null;
    if (health?.searchProtocolVersion !== ENGINE_SEARCH_PROTOCOL_VERSION)
        throw new PcSearchProtocolError(
            "The PC service needs its search-controls update before this limit can run.",
        );
    const caps = health.searchLimits;
    if (!caps || caps.infinite !== true)
        throw new PcSearchProtocolError("The PC did not provide valid search limits.");
    for (const [name, min, max] of [
        ["depth", 1, 70],
        ["timeMs", 50, 3600000],
        ["nodes", 1, 4294967295],
    ] as const) {
        const range = caps[name];
        if (
            !range ||
            !Number.isSafeInteger(range.min) ||
            !Number.isSafeInteger(range.max) ||
            range.min < min ||
            range.max > max ||
            range.max < range.min
        )
            throw new PcSearchProtocolError("The PC did not provide valid search bounds.");
    }
    return {
        depth: { ...caps.depth },
        timeMs: { ...caps.timeMs },
        nodes: { ...caps.nodes },
        infinite: true,
    };
}
export function assertPcSearchCapability(
    health: unknown,
    selected: EngineSearchLimit,
): PcSearchCapability {
    const caps = parsePcSearchCapability(health);
    if (selected.mode !== "infinite") {
        const bounds = caps[selected.mode === "time" ? "timeMs" : selected.mode];
        if (selected.value < bounds.min || selected.value > bounds.max)
            throw new PcSearchProtocolError(
                "The selected search limit is outside this PC service’s range.",
            );
    }
    return caps;
}
export async function loadPcSearchCapability(signal?: AbortSignal): Promise<PcSearchCapability> {
    const health = await loadPcEngineHealth(signal);
    signal?.throwIfAborted();
    return parsePcSearchCapability(health);
}
export function assertPcSearchReceipt(
    message: unknown,
    selected: EngineSearchLimit,
    engineKind: PcEngineKind,
): void {
    const value = message as {
        engineKind?: unknown;
        searchProtocolVersion?: unknown;
        searchLimit?: unknown;
        searchCommand?: unknown;
    } | null;
    if (
        value?.engineKind !== engineKind ||
        value.searchProtocolVersion !== ENGINE_SEARCH_PROTOCOL_VERSION ||
        value.searchCommand !== engineSearchCommand(selected)
    )
        throw new PcSearchProtocolError("The PC did not acknowledge the selected search limit.");
    const receipt = capturePcSearchLimit(value.searchLimit);
    if (engineSearchCommand(receipt) !== engineSearchCommand(selected))
        throw new PcSearchProtocolError(
            "The PC applied a different search limit. Retry or restore the previous choice.",
        );
}
