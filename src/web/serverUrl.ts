const configuredServerUrl = String(import.meta.env.VITE_EN_CROISSANT_SERVER_URL ?? "").trim();
const desktopServerUrl =
    typeof window !== "undefined" && window.location.hostname === "tauri.localhost"
        ? "http://127.0.0.1:8787"
        : "";

export const WEB_SERVER_BASE_URL = configuredServerUrl
    ? `${configuredServerUrl.replace(/\/+$/, "")}/`
    : desktopServerUrl
      ? `${desktopServerUrl}/`
      : import.meta.env.BASE_URL;

export function getWebServerUrl(path: string) {
    return `${WEB_SERVER_BASE_URL}${path.replace(/^\/+/, "")}`;
}
