import { capturePcCpuResources } from "./pcCpuResources";
import type { CpuResourceSelection } from "../../scripts/engine-resource-protocol.mjs";
export const PHONE_CPU_RESOURCES_KEY = "en-croissant-phone-cpu-resources-v1";
export type PhoneCpuPreferences = { cpuResources: CpuResourceSelection | null };
export const DEFAULT_PHONE_CPU_PREFERENCES: PhoneCpuPreferences = { cpuResources: null };
export function normalizePhoneCpuPreferences(
    value: Partial<PhoneCpuPreferences> | null,
): PhoneCpuPreferences {
    return {
        cpuResources:
            value?.cpuResources == null ? null : capturePcCpuResources(value.cpuResources),
    };
}
