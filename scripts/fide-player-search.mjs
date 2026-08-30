const FIDE_PLAYER_URL = "https://lichess.org/api/fide/player";
const MAX_RESULTS = 8;

export function parseFidePlayer(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!Number.isInteger(raw.id) || typeof raw.name !== "string" || !raw.name.trim()) return null;
  const player = { id: raw.id, name: raw.name };
  for (const field of ["title", "federation"]) {
    if (typeof raw[field] === "string") player[field] = raw[field];
  }
  if (raw.photo && typeof raw.photo === "object") {
    const photo = {};
    if (typeof raw.photo.small === "string") photo.small = raw.photo.small;
    if (typeof raw.photo.large === "string") photo.large = raw.photo.large;
    if (Object.keys(photo).length) player.photo = photo;
  }
  for (const field of ["year", "standard", "rapid", "blitz"]) {
    if (Number.isFinite(raw[field])) player[field] = raw[field];
  }
  if (raw.inactive === true) player.inactive = true;
  return player;
}

function parseFidePlayers(raw) {
  const entries = Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  const players = [];
  for (const entry of entries) {
    const player = parseFidePlayer(entry);
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    players.push(player);
  }
  return players;
}

function nameTokens(value) {
  return String(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function oneEditApart(left, right) {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4 || Math.abs(left.length - right.length) > 1) {
    return false;
  }
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

export function rankFidePlayers(query, players) {
  const terms = nameTokens(query);
  if (!terms.length) return players;
  return players
    .map((player, index) => {
      const tokens = nameTokens(player.name);
      let score = 0;
      for (const term of terms) {
        if (tokens.some((token) => token === term)) score += 12;
        else if (tokens.some((token) => token.startsWith(term))) score += 7;
        else if (tokens.some((token) => oneEditApart(token, term))) score += 4;
        else if (tokens.some((token) => token.includes(term))) score += 2;
      }
      const surname = tokens[0];
      if (surname === terms[0]) score += 10;
      else if (surname?.startsWith(terms[0])) score += 5;
      else if (surname && oneEditApart(surname, terms[0])) score += 3;
      if (player.inactive) score -= 6;
      return {
        player,
        score,
        rating: player.standard ?? player.rapid ?? player.blitz ?? 0,
        index,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || right.rating - left.rating || left.index - right.index,
    )
    .map(({ player }) => player);
}

export class FidePlayerSearchService {
  constructor({
    fetchImpl = globalThis.fetch,
    timeoutMs = 8_000,
    cacheTtlMs = 60 * 60 * 1_000,
    missTtlMs = 5 * 60 * 1_000,
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.missTtlMs = missTtlMs;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  async search(query) {
    const trimmed = String(query || "")
      .trim()
      .slice(0, 100);
    if (!trimmed) return [];
    const key = trimmed.toLocaleLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.players;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.#fetch(trimmed)
      .then((players) => {
        this.cache.set(key, {
          players,
          expiresAt: Date.now() + (players.length ? this.cacheTtlMs : this.missTtlMs),
        });
        return players;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  async #fetch(query) {
    const numeric = /^\d+$/.test(query);
    const url = numeric
      ? `${FIDE_PLAYER_URL}/${query}`
      : `${FIDE_PLAYER_URL}?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          accept: "application/json",
          "user-agent": "En Croissant private phone OTB importer/1.0",
        },
        signal: controller.signal,
      });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`Lichess FIDE lookup returned HTTP ${response.status}.`);
      const players = parseFidePlayers(await response.json());
      return (numeric ? players : rankFidePlayers(query, players)).slice(0, MAX_RESULTS);
    } finally {
      clearTimeout(timer);
    }
  }
}
