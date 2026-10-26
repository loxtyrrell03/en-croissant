import { engineResourcePlan, parseEngineDevice } from "./engineResources";
import type { Engine } from "./engines";
import { withCpuResources } from "./nativeEngineResources";

const cpu = (engine: Engine) =>
    engine.type === "local" &&
    ["Threads", "Hash"].every((name) => engine.settings?.some((setting) => setting.name === name));

/** Only the confirmed missing-store bootstrap may call this. Existing or
 * explicitly added profiles retain their own options; values never prove first use. */
export function firstUseEngineResources(profiles: Engine[], snapshot: unknown): Engine[] {
    if (!profiles.some(cpu)) return profiles;
    const device = parseEngineDevice(snapshot);
    if (!device)
        throw new Error("Could not check resources for first-use engine setup. Retry setup.");
    const plan = engineResourcePlan(
        device,
        Math.max(1, profiles.filter((engine) => cpu(engine) && engine.loaded).length),
    );
    if (!plan.canRecommend)
        throw new Error(
            "There is not enough available memory or CPU capacity for first-use engine setup. Close other apps, then retry setup.",
        );
    return profiles.map((engine) =>
        cpu(engine)
            ? {
                  ...engine,
                  settings: withCpuResources(engine.settings ?? [], plan.presets.balanced),
              }
            : engine,
    );
}
