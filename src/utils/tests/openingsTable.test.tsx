import { describe, expect, it } from "vitest";
import { isPlayableOpeningRow } from "@/components/panels/database/OpeningsTable";
import type { Opening } from "@/utils/db";

describe("OpeningsTable helpers", () => {
  it("filters terminal game sentinels from playable database moves", () => {
    const rows: Opening[] = [
      { move: "*", white: 3, draw: 0, black: 1 },
      { move: "e4", white: 2, draw: 1, black: 0 },
      { move: "Total", white: 5, draw: 1, black: 1 },
      { move: "Nf3", white: 0, draw: 0, black: 0 },
    ];

    expect(rows.filter(isPlayableOpeningRow).map((row) => row.move)).toEqual(["e4"]);
  });
});
