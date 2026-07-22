const configuredPrivateServerUrl = String(import.meta.env.VITE_EN_CROISSANT_SERVER_URL ?? "").trim();
const privateServerUrl = (
  configuredPrivateServerUrl || "https://gaming-pc.tail89d19b.ts.net"
).replace(/\/+$/, "");

const sharedCredentialUrl = `${privateServerUrl}/api/lichess-credential`;

export type SharedLichessCredential = {
  connected: true;
  token: string;
  username: string;
  updatedAt: number;
};

export async function loadSharedLichessCredential(): Promise<SharedLichessCredential | null> {
  const response = await fetch(sharedCredentialUrl, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Shared Lichess sign-in returned HTTP ${response.status}.`);
  }
  return normalizeSharedLichessCredential(await response.json());
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
