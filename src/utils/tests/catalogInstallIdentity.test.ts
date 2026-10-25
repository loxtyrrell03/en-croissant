import { expect, it } from "vitest";
import { catalogInstallKey, catalogProfile, profileAtCatalogPath } from "../catalogInstallState";
import { MANAGED_LC0_ID, type LocalEngine } from "../engines";
const managed: LocalEngine = {
    type: "local",
    id: "catalog",
    name: "LCZero",
    version: "0.32.1",
    path: "lc0/lc0.exe",
    managedInstall: "chessbot-lc0-0.32.1",
};
it("matches installed managed identities and preserves renamed discovered profiles", () => {
    const saved = {
        ...managed,
        id: MANAGED_LC0_ID,
        managedInstall: undefined,
        name: "Owner LCZero name",
        path: "D:/Shared/lc0.exe",
    };
    expect(catalogProfile([saved], managed, null)).toBe(saved);
    expect(catalogProfile([{ ...saved, id: "other" }], managed, null)).toBeUndefined();
    expect(catalogProfile([{ ...saved, version: "0.33" }], managed, null)).toBeUndefined();
    expect(
        catalogProfile([{ ...saved, path: "D:/Owner/different-program.exe" }], managed, null),
    ).toBeUndefined();
});
it("does not confuse same-name executables or archive members with one another", () => {
    const third = {
        ...managed,
        managedInstall: undefined,
        version: "1",
        path: "Vendor/Engine.exe",
        downloadLink: "https://fixture.invalid/archive.zip",
    };
    const installed = { ...third, path: "C:/Engines/vendor/engine.exe" };
    expect(catalogProfile([installed], third, null)).toBe(installed);
    expect(
        catalogProfile(
            [{ ...installed, downloadLink: "https://other.invalid/archive.zip" }],
            third,
            null,
        ),
    ).toBeUndefined();
    expect(
        catalogProfile([{ ...installed, path: "C:/Engines/other/engine.exe" }], third, null),
    ).toBeUndefined();
    expect(profileAtCatalogPath([installed], "c:\\engines\\vendor\\ENGINE.exe")).toBe(installed);
    const shared = { ...installed, path: "//Server/Engines/Vendor/ENGINE.EXE" };
    expect(catalogProfile([shared], third, null)).toBe(shared);
});
it("keeps POSIX path case and scopes retained work by catalog source instead of row index", () => {
    const saved = { ...managed, path: "/home/Owner/Engine" };
    expect(profileAtCatalogPath([saved], "/home/owner/engine")).toBeUndefined();
    expect(catalogInstallKey({ ...managed, id: "new-row-id" })).toBe(catalogInstallKey(managed));
    expect(catalogInstallKey({ ...managed, version: "0.33" })).not.toBe(catalogInstallKey(managed));
});
