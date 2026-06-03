export const WEB_LICHESS_TOKEN_STORAGE_KEY = "en-croissant-web-lichess-token";

const LICHESS_CLIENT_ID = "org.encroissant.app";
const LICHESS_AUTH_URL = "https://lichess.org/oauth";
const LICHESS_TOKEN_URL = "https://lichess.org/api/token";
const PKCE_VERIFIER_KEY = "en-croissant-web-lichess-pkce-verifier";
const OAUTH_STATE_KEY = "en-croissant-web-lichess-oauth-state";

export type WebLichessLoginResult =
  | {
      status: "complete";
      token: string;
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "none";
    };

export async function startWebLichessLogin() {
  const verifier = randomBase64Url(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomBase64Url(24);
  const redirectUri = getRedirectUri();

  window.sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  window.sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: LICHESS_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "preference:read",
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  window.location.assign(`${LICHESS_AUTH_URL}?${params.toString()}`);
}

export async function completeWebLichessLoginIfPresent(): Promise<WebLichessLoginResult> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error_description") ?? params.get("error");
  if (!code && !oauthError) return { status: "none" };

  clearOAuthQuery(params);

  if (oauthError) {
    clearPendingLogin();
    return { status: "error", message: oauthError };
  }

  const expectedState = window.sessionStorage.getItem(OAUTH_STATE_KEY);
  const verifier = window.sessionStorage.getItem(PKCE_VERIFIER_KEY);
  clearPendingLogin();

  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    return { status: "error", message: "Lichess login could not be verified." };
  }

  const response = await fetch(LICHESS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: LICHESS_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: getRedirectUri(),
    }),
  });

  if (!response.ok) {
    return { status: "error", message: `Lichess token exchange failed: ${response.status}` };
  }

  const token = (await response.json().catch(() => null))?.access_token;
  if (typeof token !== "string" || !token) {
    return { status: "error", message: "Lichess did not return an access token." };
  }

  window.localStorage.setItem(WEB_LICHESS_TOKEN_STORAGE_KEY, token);
  return { status: "complete", token };
}

function getRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function clearPendingLogin() {
  window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  window.sessionStorage.removeItem(OAUTH_STATE_KEY);
}

function clearOAuthQuery(params: URLSearchParams) {
  params.delete("code");
  params.delete("state");
  params.delete("error");
  params.delete("error_description");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function randomBase64Url(byteCount: number) {
  const bytes = new Uint8Array(byteCount);
  window.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  return base64Url(new Uint8Array(await window.crypto.subtle.digest("SHA-256", bytes)));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
