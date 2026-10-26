import { useEffect, useState } from "react";
import { commands } from "@/bindings";
import { parseEngineDevice, type EngineDevice } from "@/utils/engineResources";

/** A read-only snapshot for the local native analysis host, never phone hardware. */
export function useEngineDeviceSnapshot() {
    const [attempt, retry] = useState(0);
    const [state, setState] = useState<{
        device: EngineDevice | null;
        checking: boolean;
        error: string | null;
    }>({ device: null, checking: true, error: null });
    useEffect(() => {
        let current = true;
        setState((value) => ({ ...value, checking: true, error: null }));
        const timeout = setTimeout(() => {
            if (current) {
                current = false;
                setState({
                    device: null,
                    checking: false,
                    error: "Computer resources are unavailable.",
                });
            }
        }, 5000);
        void commands
            .engineDeviceInfo()
            .then((raw) => {
                if (!current) return;
                const device = parseEngineDevice(raw);
                setState({
                    device,
                    checking: false,
                    error: device ? null : "Computer resources are unavailable.",
                });
            })
            .catch(() => {
                if (current)
                    setState({
                        device: null,
                        checking: false,
                        error: "Computer resources are unavailable.",
                    });
            })
            .finally(() => clearTimeout(timeout));
        return () => {
            current = false;
            clearTimeout(timeout);
        };
    }, [attempt]);
    return { ...state, retryDevice: () => retry((value) => value + 1) };
}
