import { describe, expect, test } from "vitest";
import {
    getArchivedDatabaseFolderAncestor,
    isDatabaseArchived,
    isSameOrDescendantDatabaseFolder,
    replaceArchivedDatabaseFolderPrefix,
    replaceArchivedDatabasePath,
    setDatabaseFolderArchived,
    setDatabasePathArchived,
} from "../databaseArchive";

describe("database archive helpers", () => {
    test("a folder archive includes nested database folders but not similar names", () => {
        expect(isSameOrDescendantDatabaseFolder("Opponent Prep/Oxford", "Opponent Prep")).toBe(
            true,
        );
        expect(isSameOrDescendantDatabaseFolder("Opponent Preparation", "Opponent Prep")).toBe(
            false,
        );
        expect(getArchivedDatabaseFolderAncestor("opponent prep\\Oxford", ["Opponent Prep"])).toBe(
            "Opponent Prep",
        );
    });

    test("databases can be archived directly or through a parent folder", () => {
        const archiveState = {
            databasePaths: ["C:\\Databases\\personal.db3"],
            folderPaths: ["Opponent Prep"],
        };

        expect(
            isDatabaseArchived(
                { file: "c:/databases/personal.db3", folder: "Personal" },
                archiveState,
            ),
        ).toBe(true);
        expect(
            isDatabaseArchived(
                { file: "C:\\Databases\\oxford.db3", folder: "Opponent Prep/Oxford" },
                archiveState,
            ),
        ).toBe(true);
        expect(
            isDatabaseArchived(
                { file: "C:\\Databases\\masters.db3", folder: "Reference" },
                archiveState,
            ),
        ).toBe(false);
    });

    test("archiving and restoring a folder collapses descendant archive markers", () => {
        const archived = setDatabaseFolderArchived(
            ["Opponent Prep/Oxford", "Online Games"],
            "Opponent Prep",
            true,
        );
        expect(archived).toEqual(["Online Games", "Opponent Prep"]);
        expect(setDatabaseFolderArchived(archived, "Opponent Prep", false)).toEqual([
            "Online Games",
        ]);
    });

    test("direct database markers remain unique and follow file moves", () => {
        const archived = setDatabasePathArchived(
            ["C:\\Databases\\game.db3"],
            "c:/databases/game.db3",
            true,
        );
        expect(archived).toHaveLength(1);
        expect(
            replaceArchivedDatabasePath(
                archived,
                "C:\\Databases\\game.db3",
                "C:\\Databases\\Archive\\game.db3",
            ),
        ).toEqual(["C:\\Databases\\Archive\\game.db3"]);
    });

    test("archived folder markers follow folder renames", () => {
        expect(
            replaceArchivedDatabaseFolderPrefix(
                ["Opponent Prep", "Opponent Prep/Oxford", "Online Games"],
                "Opponent Prep",
                "Preparation",
            ),
        ).toEqual(["Preparation", "Preparation/Oxford", "Online Games"]);
    });
});
