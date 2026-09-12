// Private home builds use their actual host so a Tailscale device rename never
// leaves API consumers pointing at a defunct hostname. Public hosted builds
// retain their explicitly configured remote PC URL.
export function resolvePrivateServiceUrl(configured: unknown) {
    return import.meta.env.VITE_EN_CROISSANT_HOME_BUILD === "1" && typeof window !== "undefined"
        ? window.location.origin
        : String(configured ?? "").trim();
}
const configuredServerUrl = resolvePrivateServiceUrl(import.meta.env.VITE_EN_CROISSANT_SERVER_URL);

export const WEB_SERVER_BASE_URL = configuredServerUrl
    ? `${configuredServerUrl.replace(/\/+$/, "")}/`
    : import.meta.env.BASE_URL;

export function getWebServerUrl(path: string) {
    return `${WEB_SERVER_BASE_URL}${path.replace(/^\/+/, "")}`;
}
