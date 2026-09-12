import { useSyncExternalStore } from "react";
import { getWebServerUrl } from "./serverUrl";

export const PC_SERVICES_CHANGED = "en-croissant-pc-services";
export type PcServicesStatus = {
    ok: true;
    service: "en-croissant-service-controller";
    enabled: boolean;
    busy: boolean;
    home: boolean;
    engine: boolean;
    error: string | null;
};
let availability = "unknown";
export function publishPcServicesStatus(status: PcServicesStatus) {
    const next = !status.enabled ? "off" : status.home && status.engine ? "ready" : "starting";
    if (next === availability) return;
    availability = next;
    window.dispatchEvent(new Event(PC_SERVICES_CHANGED));
}
const subscribe = (notify: () => void) => {
    window.addEventListener(PC_SERVICES_CHANGED, notify);
    return () => window.removeEventListener(PC_SERVICES_CHANGED, notify);
};
export function usePcServicesAvailability() {
    return useSyncExternalStore(
        subscribe,
        () => availability,
        () => "unknown",
    );
}
export async function requestPcServices(
    enabled?: boolean,
    signal?: AbortSignal,
): Promise<PcServicesStatus> {
    const response = await fetch(getWebServerUrl("api/pc-services"), {
        method: enabled === undefined ? "GET" : "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-en-croissant-client": "phone-services" },
        ...(enabled === undefined ? {} : { body: JSON.stringify({ enabled }) }),
        signal,
    });
    const result = await response.json();
    if (
        result.service !== "en-croissant-service-controller" ||
        typeof result.enabled !== "boolean" ||
        typeof result.home !== "boolean" ||
        typeof result.engine !== "boolean"
    ) {
        throw new Error(
            "PC control is unreachable. Check the PC is awake and connected to Tailscale.",
        );
    }
    // A failed start still carries verified status and the saved requested state.
    publishPcServicesStatus(result);
    return result;
}
