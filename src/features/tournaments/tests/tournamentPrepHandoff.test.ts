import { describe, expect, test } from "vitest";
import { PREP_KEYS } from "@/features/tournaments/prepPersistence";
import {
  consumeTournamentPrepHandoff,
  hasPendingTournamentPrepHandoff,
  stageTournamentPrepHandoff,
  TOURNAMENT_PREP_HANDOFF_KEY,
} from "../tournamentPrepHandoff";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("tournament prep handoff", () => {
  test("stages opponent filters and is consumed only by the side Prep panel", () => {
    const storage = new MemoryStorage();
    stageTournamentPrepHandoff(
      { collectionId: 42, playerName: "Jane Doe", userSide: "black", tournamentTitle: "Open" },
      storage,
    );
    expect(hasPendingTournamentPrepHandoff(storage)).toBe(true);
    expect(storage.getItem(PREP_KEYS.mode)).toBe("opponent");
    expect(storage.getItem(PREP_KEYS.player)).toBe("Jane Doe");
    expect(storage.getItem(PREP_KEYS.playerColor)).toBe("white");
    expect(consumeTournamentPrepHandoff("under", storage)).toBeNull();
    expect(consumeTournamentPrepHandoff("side", storage)?.collectionId).toBe(42);
    expect(storage.getItem(TOURNAMENT_PREP_HANDOFF_KEY)).toBeNull();
  });
});
