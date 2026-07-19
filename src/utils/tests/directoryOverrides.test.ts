import { describe, expect, it } from "vitest";
import {
  isEphemeralDirectoryOverride,
  readStoredDirectoryOverride,
} from "@/utils/directoryOverrides";

function createStorage(value: string | null) {
  let stored = value;
  return {
    getItem: () => stored,
    removeItem: () => {
      stored = null;
    },
    value: () => stored,
  };
}

describe("directory overrides", () => {
  it("keeps ordinary custom directories", () => {
    const storage = createStorage(JSON.stringify("D:\\Chess\\Databases"));

    expect(readStoredDirectoryOverride("databases-dir", storage)).toBe(
      "D:\\Chess\\Databases",
    );
    expect(storage.value()).not.toBeNull();
  });

  it("clears parity-test directories before they can hide the real library", () => {
    const path =
      "C:\\Users\\loxty\\AppData\\Local\\Temp\\outpost-fork-parity-v1\\db";
    const storage = createStorage(JSON.stringify(path));

    expect(isEphemeralDirectoryOverride(path)).toBe(true);
    expect(readStoredDirectoryOverride("databases-dir", storage)).toBeNull();
    expect(storage.value()).toBeNull();
  });
});
