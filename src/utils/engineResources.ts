// Keep the policy free of UI and Tauri runtime imports: the PC service uses the
// same implementation as the native and phone resource controls.
export {
    CPU_RESOURCE_PRESETS,
    engineResourcePlan,
    matchingCpuResourcePreset,
    memoryStops,
    parseEngineDevice,
} from "../../scripts/engine-resource-presets.mjs";
export type {
    CpuResourcePreset,
    EngineDevice,
    EngineResourcePlan,
    EngineResourceValues,
} from "../../scripts/engine-resource-presets.mjs";
