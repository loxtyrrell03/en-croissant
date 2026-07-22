import { describe, expect, it } from "vitest";
import {
  chooseDocumentDirectoryPath,
  isEphemeralDirectoryOverride,
  readStoredDirectoryOverride,
  recoverParityTestArchivedFileEntries,
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

function createKeyedStorage(values: Record<string, string>) {
  const stored = new Map(Object.entries(values));
  return {
    getItem: (key: string) => stored.get(key) ?? null,
    removeItem: (key: string) => stored.delete(key),
    setItem: (key: string, value: string) => stored.set(key, value),
    value: (key: string) => stored.get(key) ?? null,
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

  it("restores parity-archived folders without changing legitimate archives", () => {
    const legitimate = "C:\\Users\\loxty\\Documents\\EnCroissant\\Old studies";
    const storage = createKeyedStorage({
      "archived-file-entries": JSON.stringify([
        legitimate,
        "C:\\Users\\loxty\\Documents\\EnCroissant\\Ifan prep",
        "C:\\Users\\loxty\\Documents\\EnCroissant\\Oxford FIDE Congress U2300 player games",
      ]),
    });

    expect(recoverParityTestArchivedFileEntries(storage)).toEqual([legitimate]);
    expect(JSON.parse(storage.value("archived-file-entries") ?? "[]")).toEqual([legitimate]);
    expect(storage.value("parity-file-visibility-recovery-v1")).toBe("done");
  });

  it("uses a populated local library instead of an empty OneDrive default", () => {
    const platformPath = "C:\\Users\\loxty\\OneDrive\\Documents\\EnCroissant";
    const localPath = "C:\\Users\\loxty\\Documents\\EnCroissant";

    expect(
      chooseDocumentDirectoryPath({
        storedPath: platformPath,
        platformPath,
        localDocumentsPath: localPath,
        populatedPaths: new Set([localPath.replaceAll("\\", "/").toLowerCase()]),
      }),
    ).toBe(localPath);
  });

  it("preserves an explicit populated custom library", () => {
    const customPath = "D:\\Chess\\Files";

    expect(
      chooseDocumentDirectoryPath({
        storedPath: customPath,
        platformPath: "C:\\Users\\loxty\\OneDrive\\Documents\\EnCroissant",
        localDocumentsPath: "C:\\Users\\loxty\\Documents\\EnCroissant",
        populatedPaths: new Set(),
      }),
    ).toBe(customPath);
  });
});
