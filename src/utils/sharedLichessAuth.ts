const configuredPrivateServerUrl = String(import.meta.env.VITE_EN_CROISSANT_SERVER_URL ?? "").trim();
const privateServerUrl = (
  configuredPrivateServerUrl || window.location.origin
).replace(/\/+$/, "");

const sharedCredentialUrl = `${privateServerUrl}/api/lichess-credential`;
const SHARED_CREDENTIAL_TIMEOUT_MS = 5_000;

export type SharedLichessCredential = {
  connected: true;
  token: string;
  username: string;
  updatedAt: number;
};

export async function loadSharedLichessCredential(
  options: { timeoutMs?: number } = {},
): Promise<SharedLichessCredential | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? SHARED_CREDENTIAL_TIMEOUT_MS,
  );
  try {
    const response = await fetch(sharedCredentialUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Shared Lichess sign-in returned HTTP ${response.status}.`);
    }
    return normalizeSharedLichessCredential(await response.json());
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function saveSharedLichessCredential(
  token: string,
): Promise<SharedLichessCredential> {
  const response = await fetch(sharedCredentialUrl, {
    method: "PUT",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ token: token.trim() }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `Could not save shared Lichess sign-in (HTTP ${response.status}).`,
    );
  }
  const credential = normalizeSharedLichessCredential(await response.json());
  if (!credential) throw new Error("The shared Lichess sign-in response was invalid.");
  return credential;
}

function normalizeSharedLichessCredential(value: unknown): SharedLichessCredential | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("connected" in value) ||
    value.connected !== true ||
    !("token" in value) ||
    typeof value.token !== "string" ||
    !value.token.trim() ||
    !("username" in value) ||
    typeof value.username !== "string" ||
    !value.username.trim()
  ) {
    return null;
  }
  return {
    connected: true,
    token: value.token,
    username: value.username.trim(),
    updatedAt:
      "updatedAt" in value && typeof value.updatedAt === "number"
        ? value.updatedAt
        : Date.now(),
  };
}
