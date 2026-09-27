const FIDE_PLAYER_URL = "https://lichess.org/api/fide/player";
const MAX_RESULTS = 8;

export function parseFidePlayer(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (
    !Number.isSafeInteger(raw.id) ||
    raw.id <= 0 ||
    typeof raw.name !== "string" ||
    !raw.name.trim()
  )
    return null;
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
    if (Number.isSafeInteger(raw[field]) && raw[field] > 0) player[field] = raw[field];
  }
  if (raw.inactive === true || raw.inactive === 1) player.inactive = true;
  return player;
}

function parseFidePlayers(raw) {
  const entries = Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  const players = [];
  for (const entry of entries) {
    const player = parseFidePlayer(entry);
    if (!player) throw new Error("FIDE lookup returned an unreadable response. Retry the search.");
    if (seen.has(player.id)) continue;
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
    maxCacheEntries = 128,
    minSpacingMs = 500,
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.missTtlMs = missTtlMs;
    this.maxCacheEntries = maxCacheEntries;
    this.minSpacingMs = minSpacingMs;
    this.nextStart = 0;
    this.backoffUntil = 0;
    this.tail = Promise.resolve();
    this.cache = new Map();
    this.inFlight = new Map();
  }

  async search(query, signal) {
    if (signal?.aborted) throw signal.reason;
    const trimmed = String(query || "")
      .trim()
      .slice(0, 100);
    if (!trimmed) return [];
    const key = trimmed.toLocaleLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.players;
    if (this.backoffUntil > Date.now()) throw busyError();
    let pending = this.inFlight.get(key);
    if (!pending) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error("FIDE lookup took too long. Retry the search.")),
        this.timeoutMs,
      );
      const entry = { controller, readers: 0, promise: null };
      // A queued request gets the same deadline as its body read. The lane keeps
      // its order even if a queued caller cancels before the previous one ends.
      const operation = this.tail.then(async () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        await waitForStart(Math.max(0, this.nextStart - Date.now()), controller.signal);
        if (this.backoffUntil > Date.now()) throw busyError();
        this.nextStart = Date.now() + this.minSpacingMs;
        return untilAborted(this.#fetch(trimmed, controller.signal), controller.signal);
      });
      this.tail = operation.then(
        () => {},
        () => {},
      );
      entry.promise = untilAborted(operation, controller.signal)
        .then((players) => {
          if (controller.signal.aborted) throw controller.signal.reason;
          this.cache.delete(key);
          this.cache.set(key, {
            players,
            expiresAt: Date.now() + (players.length ? this.cacheTtlMs : this.missTtlMs),
          });
          while (this.cache.size > this.maxCacheEntries)
            this.cache.delete(this.cache.keys().next().value);
          return players;
        })
        .finally(() => {
          clearTimeout(timer);
          if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
        });
      this.inFlight.set(key, entry);
      pending = entry;
    }
    pending.readers += 1;
    try {
      return await untilAborted(pending.promise, signal);
    } finally {
      pending.readers -= 1;
      if (pending.readers === 0 && this.inFlight.get(key) === pending) {
        this.inFlight.delete(key);
        pending.controller.abort();
      }
    }
  }

  async #fetch(query, signal) {
    const numeric = /^\d+$/.test(query);
    const url = numeric
      ? `${FIDE_PLAYER_URL}/${query}`
      : `${FIDE_PLAYER_URL}?q=${encodeURIComponent(query)}`;
    const response = await this.fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "En Croissant private phone OTB importer/1.0",
      },
      signal,
    });
    if (signal.aborted) throw signal.reason;
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      const seconds = Number(retry);
      const requested = seconds > 0 ? seconds * 1000 : Date.parse(retry) - Date.now();
      this.backoffUntil = Math.max(
        this.backoffUntil,
        Date.now() + Math.max(60_000, Number.isFinite(requested) ? requested : 0),
      );
      throw busyError();
    }
    if (numeric && response.status === 404) return [];
    if (!response.ok) throw new Error(`Lichess FIDE lookup returned HTTP ${response.status}.`);
    const body = await response.json();
    if (signal.aborted) throw signal.reason;
    if (numeric ? Array.isArray(body) : !Array.isArray(body))
      throw new Error("FIDE lookup returned an unreadable response. Retry the search.");
    const players = parseFidePlayers(body);
    if (numeric && (players.length !== 1 || players[0].id !== Number(query)))
      throw new Error("FIDE lookup returned a different player. Retry the search.");
    return (numeric ? players : rankFidePlayers(query, players)).slice(0, MAX_RESULTS);
  }
}

function busyError() {
  return new Error("FIDE lookup is busy. Wait at least a minute before retrying.");
}

function untilAborted(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const detach = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      detach();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(
      (value) => {
        detach();
        resolve(value);
      },
      (error) => {
        detach();
        reject(error);
      },
    );
  });
}

function waitForStart(ms, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
