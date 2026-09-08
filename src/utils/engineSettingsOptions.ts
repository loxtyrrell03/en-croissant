import type { EngineOption } from "@/bindings";
import type { EngineSettings } from "./engines";

/** Pure UCI conversion shared by UI and workers. Keep runtime UI/Tauri imports
 * out of this module: development workers evaluate imports without tree shaking. */
export function engineSettingsToOptions(
    settings: EngineSettings | null | undefined,
): EngineOption[] {
    return (settings ?? [])
        .filter((setting) => setting.name.trim() && setting.value !== null)
        .map((setting) => ({
            name: setting.name,
            value: String(setting.value),
        }));
}
