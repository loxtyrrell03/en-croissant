import { beforeEach, expect, test, vi } from "vitest";
import { getLastOnlineDatabaseGameDate } from "../onlineGameImport";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/utils/db", () => ({ query_games: query }));
beforeEach(() => query.mockReset());

test.each([
  ["2026.02.30", "12:00:00", null],
  ["2026.10.24", "25:00:00", Date.UTC(2026, 9, 24)],
  ["2026.10.24", null, Date.UTC(2026, 9, 24)],
  ["2024.02.29", "12:30:05", Date.UTC(2024, 1, 29, 12, 30, 5)],
] as const)("desktop sync cursor validates %s %s", async (date, time, expected) => {
  query.mockResolvedValue({ count: 1, data: [{ date, time }] });
  expect(await getLastOnlineDatabaseGameDate("synthetic.db3")).toBe(expected);
});

test("empty database has no invented cursor", async () => {
  query.mockResolvedValue({ count: 0, data: [] });
  expect(await getLastOnlineDatabaseGameDate("synthetic.db3")).toBeNull();
});
