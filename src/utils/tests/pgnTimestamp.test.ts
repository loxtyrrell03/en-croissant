import { describe, expect, test } from "vitest";
import { onlinePgnTimestamp, parsePgnDateTime } from "../pgnTimestamp";

describe("online PGN dates", () => {
  test.each(["2026.02.29", "2026.02.30", "2026.04.31", "2026.00.10", "2026.13.01", "2026.01.00", "2026.01.32", "????.??.??", "2026.10.??", "2026-02-30T12:30:00Z"])("rejects impossible or unknown date %s", date => {
    expect(parsePgnDateTime(date, "12:00:00")).toBeNull();
  });
  test.each(["24:00:00", "12:60:00", "12:00:60", "??:??:??", "-", "25:99", "12:00garbage"])("retains a valid day with unknown time %s", time => {
    expect(parsePgnDateTime("2026.10.24", time)).toBe(Date.UTC(2026, 9, 24));
  });
  test("preserves leap days, optional seconds and early calendar years", () => {
    expect(parsePgnDateTime("2024.02.29", "9:30")).toBe(Date.UTC(2024, 1, 29, 9, 30));
    expect(new Date(parsePgnDateTime("0099.01.02")!).getUTCFullYear()).toBe(99);
    expect(parsePgnDateTime("2026/10/24", "12:30:05")).toBe(Date.UTC(2026, 9, 24, 12, 30, 5));
  });
  test("preserves explicit ISO offsets and rejects rolled ISO clocks", () => {
    expect(parsePgnDateTime("2026-10-24T12:30:00+01:00")).toBe(Date.UTC(2026, 9, 24, 11, 30));
    expect(parsePgnDateTime("2026-10-24T12:30:00Z")).toBe(Date.UTC(2026, 9, 24, 12, 30));
    expect(parsePgnDateTime("2026-10-24T24:00:00Z")).toBeNull();
    expect(parsePgnDateTime("2026-10-24T12:60:00Z")).toBeNull();
  });
  test("keeps provider header precedence without normalizing a bad date", () => {
    expect(onlinePgnTimestamp('[Date "2026.10.01"]\n[UTCDate "2026.10.23"]\n[EndDate "2026.10.24"]\n[EndTime "12:30:00"]')).toBe(Date.UTC(2026, 9, 24, 12, 30));
    expect(onlinePgnTimestamp('[Date "2026.02.30"]')).toBe(0);
    expect(onlinePgnTimestamp('[UTCDate "2026.10.24"]\n[UTCTime "24:00:00"]')).toBe(Date.UTC(2026, 9, 24));
  });
});
