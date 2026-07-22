const configuredServerUrl = String(import.meta.env.VITE_EN_CROISSANT_SERVER_URL ?? "").trim();

export const WEB_SERVER_BASE_URL = configuredServerUrl
    ? `${configuredServerUrl.replace(/\/+$/, "")}/`
    : import.meta.env.BASE_URL;

export function getWebServerUrl(path: string) {
    return `${WEB_SERVER_BASE_URL}${path.replace(/^\/+/, "")}`;
}
