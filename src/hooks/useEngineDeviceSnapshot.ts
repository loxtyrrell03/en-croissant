import { useEffect, useState } from "react";
import type { EngineDevice } from "@/utils/engineResources";
import { loadNativeEngineDevice } from "@/utils/nativeEngineDevice";

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
        void loadNativeEngineDevice()
            .then((device) => {
                if (!current) return;
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
            });
        return () => {
            current = false;
        };
    }, [attempt]);
    return { ...state, retryDevice: () => retry((value) => value + 1) };
}
