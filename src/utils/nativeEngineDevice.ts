import { commands } from "@/bindings";
import { parseEngineDevice, type EngineDevice } from "./engineResources";

/** Read-only native host snapshot. A timeout never launches or restarts an engine. */
export async function loadNativeEngineDevice(): Promise<EngineDevice> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            commands.engineDeviceInfo().then((value) => {
                const device = parseEngineDevice(value);
                if (!device) throw new Error("Computer resources are unavailable.");
                return device;
            }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Computer resources are unavailable.")),
                    5000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
