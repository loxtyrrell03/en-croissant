import {
    CPU_RESOURCE_PROTOCOL_VERSION,
    parseCpuResourceRequest,
    type CpuResourceSelection,
} from "../../scripts/engine-resource-protocol.mjs";
import { parseEngineDevice, type EngineDevice } from "@/utils/engineResources";
import { PHONE_PC_ENGINE_URL, PcEngineCapabilityError, loadPcEngineHealth } from "./pcEngineHealth";
export { PHONE_PC_ENGINE_URL } from "./pcEngineHealth";
export class PcResourceProtocolError extends PcEngineCapabilityError {}
export type PcCpuCapability = {
    device: EngineDevice;
    bounds: { threads: { min: number; max: number }; hashMb: { min: number; max: number } };
};
export function capturePcCpuResources(value: unknown): CpuResourceSelection {
    try {
        return parseCpuResourceRequest({ cpuResources: value }, "stockfish")!;
    } catch {
        throw new PcResourceProtocolError(
            "The saved PC resources are invalid. Choose supported CPU settings.",
        );
    }
}
export function parsePcCpuCapability(value: unknown): PcCpuCapability {
    const health = value as {
        resourceProtocolVersion?: unknown;
        device?: unknown;
        cpuResources?: PcCpuCapability["bounds"];
    } | null;
    if (health?.resourceProtocolVersion !== CPU_RESOURCE_PROTOCOL_VERSION)
        throw new PcResourceProtocolError(
            "The PC service needs its resource-controls update before these settings can run.",
        );
    const device = parseEngineDevice(health.device),
        bounds = health.cpuResources;
    if (!device || !bounds)
        throw new PcResourceProtocolError("The PC did not provide valid resource details.");
    for (const [name, min, max] of [
        ["threads", 1, 64],
        ["hashMb", 16, 8192],
    ] as const) {
        const field = bounds[name];
        if (
            !field ||
            !Number.isSafeInteger(field.min) ||
            !Number.isSafeInteger(field.max) ||
            field.min < min ||
            field.max > max ||
            field.max < field.min
        )
            throw new PcResourceProtocolError("The PC did not provide valid resource bounds.");
    }
    return { device, bounds: { threads: { ...bounds.threads }, hashMb: { ...bounds.hashMb } } };
}
/** Read-only, bounded even if fetch ignores cancellation. Never wakes a service
 * or substitutes the phone's hardware for the PC. */
export async function loadPcCpuCapability(
    signal?: AbortSignal,
    base = PHONE_PC_ENGINE_URL,
): Promise<PcCpuCapability> {
    const health = await loadPcEngineHealth(signal, base);
    signal?.throwIfAborted();
    return parsePcCpuCapability(health);
}

export function assertPcCpuReceipt(message: unknown, selected: CpuResourceSelection): void {
    const value = message as {
        engineKind?: unknown;
        resourceProtocolVersion?: unknown;
        cpuResources?: unknown;
        threads?: unknown;
        hashMb?: unknown;
    };
    if (
        value?.engineKind !== "stockfish" ||
        value?.resourceProtocolVersion !== CPU_RESOURCE_PROTOCOL_VERSION ||
        value.threads !== selected.threads ||
        value.hashMb !== selected.hashMb
    )
        throw new PcResourceProtocolError("The PC did not acknowledge the selected CPU resources.");
    const receipt = capturePcCpuResources(value.cpuResources);
    if (receipt.threads !== selected.threads || receipt.hashMb !== selected.hashMb)
        throw new PcResourceProtocolError(
            "The PC applied different CPU resources. Retry or restore the previous settings.",
        );
}
