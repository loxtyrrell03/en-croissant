import { Button, Modal, SimpleGrid, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useLoaderData } from "@tanstack/react-router";
import { resolve, dirname, basename } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getDefaultDatabaseFolderName,
  getGameFileCountText,
  splitGameSourceToFiles,
  validateDatabaseFilesFolderName,
} from "@/utils/databaseFileExport";
import { createFile } from "@/utils/files";
import PathFileInput from "../common/FileInput";
import GenericCard from "../common/GenericCard";
import type { Directory, FileMetadata, FileType } from "./file";

const FILE_TYPES = [
  { label: "Game", value: "game" },
  { label: "Repertoire", value: "repertoire" },
  { label: "Tournament", value: "tournament" },
  { label: "Puzzle", value: "puzzle" },
  { label: "Other", value: "other" },
] as const;

type Entry = FileMetadata | Directory;

const INVALID_RENAME_CHARS = /[\\/:*?"<>|]/;

function removePgnExtension(name: string) {
  return name.toLowerCase().endsWith(".pgn") ? name.slice(0, -4) : name;
}

function getInfoPath(path: string) {
  return path.replace(/\.pgn$/i, ".info");
}

function getTargetLabel(selected: Entry | null) {
  if (!selected) return "Files root";
  if (selected.type === "directory") return selected.name;
  return `${selected.name}'s folder`;
}

function replacePathPrefix(path: string, oldPath: string, newPath: string) {
  if (path === oldPath) {
    return newPath;
  }

  if (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }

  return path;
}

function withRenamedEntryPaths(
  entry: Entry,
  oldPath: string,
  newPath: string,
  name: string,
): Entry {
  if (entry.type === "file") {
    return {
      ...entry,
      name,
      path: newPath,
      lastModified: Date.now(),
    };
  }

  return {
    ...entry,
    name,
    path: newPath,
    children: entry.children.map((child) => withUpdatedPathPrefix(child, oldPath, newPath)),
  };
}

function withUpdatedPathPrefix(entry: Entry, oldPath: string, newPath: string): Entry {
  if (entry.type === "file") {
    return {
      ...entry,
      path: replacePathPrefix(entry.path, oldPath, newPath),
    };
  }

  return {
    ...entry,
    path: replacePathPrefix(entry.path, oldPath, newPath),
    children: entry.children.map((child) => withUpdatedPathPrefix(child, oldPath, newPath)),
  };
}

export type RenameResult = {
  oldPath: string;
  newPath: string;
  oldEntry: Entry;
  newEntry: Entry;
};

export function ImportDatabaseFolderModal({
  opened,
  setOpened,
  mutate,
  selected,
  setSelected,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
  mutate: () => Promise<unknown> | unknown;
  selected: Entry | null;
  setSelected: React.Dispatch<React.SetStateAction<Entry | null>>;
}) {
  const [sourcePath, setSourcePath] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { documentDir } = useLoaderData({ from: "/files" });

  useEffect(() => {
    if (!opened) {
      setError("");
    }
  }, [opened]);

  function reset() {
    setSourcePath("");
    setSourceName("");
    setFolderName("");
    setError("");
  }

  async function getTargetParent() {
    if (!selected) return documentDir;
    if (selected.type === "directory") return selected.path;
    return await dirname(selected.path);
  }

  async function chooseSource() {
    const selectedFile = await open({
      multiple: false,
      filters: [
        {
          name: "Chess database or PGN",
          extensions: ["pgn", "zst", "bz2", "db3"],
        },
      ],
    });
    if (!selectedFile || typeof selectedFile !== "string") return;

    const name = await basename(selectedFile);
    setSourcePath(selectedFile);
    setSourceName(name);
    setError("");
    if (!folderName.trim()) {
      setFolderName(getDefaultDatabaseFolderName(name));
    }
  }

  async function importDatabase() {
    if (!sourcePath) {
      setError("Choose a PGN or database file first.");
      return;
    }

    const trimmedFolderName = folderName.trim();
    if (!trimmedFolderName) {
      setError("Folder name is required.");
      return;
    }

    const folderNameError = validateDatabaseFilesFolderName(trimmedFolderName);
    if (folderNameError) {
      setError(folderNameError);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const targetParent = await getTargetParent();
      const targetDir = await resolve(targetParent, trimmedFolderName);

      const report = await splitGameSourceToFiles({ sourcePath, targetDir, fileType: "game" });
      await mutate();
      setSelected({
        type: "directory",
        name: trimmedFolderName,
        path: report.targetDir,
        children: [],
        lastModified: Date.now(),
      });
      notifications.show({
        title: "Imported database",
        message: `Created ${getGameFileCountText(report.created)} in ${trimmedFolderName}.`,
        color: "green",
      });
      reset();
      setOpened(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title="Import database as files">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void importDatabase();
        }}
      >
        <Stack>
          <Text c="dimmed" size="sm">
            Choose a PGN, compressed PGN, or En Croissant database. The named folder will be created
            or reused under {getTargetLabel(selected)}, with one game file per game.
          </Text>

          <PathFileInput
            label="Source database"
            description="PGN, PGN.ZST, PGN.BZ2, or DB3"
            filename={sourceName || null}
            onClick={chooseSource}
            withAsterisk
          />

          <TextInput
            label="Folder name"
            description="Each imported game will be saved as a separate PGN file in this folder."
            value={folderName}
            onChange={(e) => {
              setFolderName(e.currentTarget.value);
              if (error) setError("");
            }}
            error={error}
          />

          <Button type="submit" loading={loading}>
            {loading ? "Importing..." : "Import games"}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

export function CreateModal({
  opened,
  setOpened,
  files,
  setFiles,
  setSelected,
  selected,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
  files: (FileMetadata | Directory)[];
  setFiles: (files: (FileMetadata | Directory)[]) => void;
  setSelected: React.Dispatch<React.SetStateAction<FileMetadata | Directory | null>>;
  selected: FileMetadata | Directory | null;
}) {
  const { t } = useTranslation();

  const [filename, setFilename] = useState("");
  const [filetype, setFiletype] = useState<FileType>("game");
  const [pgn, setPgn] = useState("");
  const [error, setError] = useState("");
  const { documentDir } = useLoaderData({ from: "/files" });

  async function addFile() {
    const trimmedFilename = filename.trim();
    if (!trimmedFilename) {
      setError(t("Common.RequireName"));
      return;
    }

    let targetDir = documentDir;
    if (selected) {
      if (selected.type === "directory") {
        targetDir = selected.path;
      } else {
        targetDir = await dirname(selected.path);
      }
    }

    const newFile = await createFile({
      filename: trimmedFilename,
      filetype,
      pgn,
      dir: targetDir,
    });
    if (newFile.isErr) {
      setError(newFile.error.message);
    } else {
      setFiles([...files, newFile.value]);
      setSelected(newFile.value);
      setError("");
      setOpened(false);
      setFilename("");
      setFiletype("game");
    }
  }

  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title={t("Files.Create.Title")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addFile();
        }}
      >
        <Stack>
          <TextInput
            label={t("Common.Name")}
            placeholder={t("Common.EnterFileName")}
            value={filename}
            onChange={(e) => {
              setFilename(e.currentTarget.value);
              if (error) setError("");
            }}
            error={error}
          />

          <Text fz="sm" fw="bold">
            {t("Files.FileType")}
          </Text>

          <SimpleGrid cols={3}>
            {FILE_TYPES.map((v) => (
              <GenericCard
                key={v.value}
                id={v.value}
                isSelected={filetype === v.value}
                setSelected={setFiletype}
                Header={<Text ta="center">{t(`Files.FileType.${v.label}`)}</Text>}
              />
            ))}
          </SimpleGrid>

          <Textarea
            value={pgn}
            onChange={(event) => setPgn(event.currentTarget.value)}
            label={t("Common.PGNGame")}
            placeholder={t("Files.Create.PGNPlaceholder")}
            rows={10}
          />

          <Button style={{ marginTop: "1rem" }} type="submit">
            {t("Common.Create")}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

export function RenameModal({
  opened,
  setOpened,
  entry,
  mutate,
  setSelected,
  onRenamed,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
  entry: Entry | null;
  mutate: () => Promise<unknown> | unknown;
  setSelected: React.Dispatch<React.SetStateAction<Entry | null>>;
  onRenamed: (result: RenameResult) => void;
}) {
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!opened || !entry) return;
    setName(entry.name);
    setError("");
  }, [opened, entry]);

  async function renameEntry() {
    if (!entry) return;

    const rawName = name.trim();
    const nextName = entry.type === "file" ? removePgnExtension(rawName).trim() : rawName;

    if (!nextName) {
      setError(t("Common.RequireName"));
      return;
    }

    if (nextName === "." || nextName === ".." || INVALID_RENAME_CHARS.test(nextName)) {
      setError("Name cannot contain path separators or reserved filename characters.");
      return;
    }

    if (nextName === entry.name) {
      setOpened(false);
      return;
    }

    const parentDir = await dirname(entry.path);
    const newPath = await resolve(parentDir, entry.type === "file" ? `${nextName}.pgn` : nextName);

    if (newPath !== entry.path && (await exists(newPath))) {
      setError(t("Common.NameAlreadyUsed"));
      return;
    }

    try {
      await rename(entry.path, newPath);

      if (entry.type === "file") {
        await rename(getInfoPath(entry.path), getInfoPath(newPath)).catch(() => {});
      }

      const newEntry = withRenamedEntryPaths(entry, entry.path, newPath, nextName);
      onRenamed({
        oldPath: entry.path,
        newPath,
        oldEntry: entry,
        newEntry,
      });
      await mutate();
      setSelected(newEntry);
      setError("");
      setOpened(false);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Modal opened={opened && !!entry} onClose={() => setOpened(false)} title="Rename">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void renameEntry();
        }}
      >
        <Stack>
          <TextInput
            label={t("Common.Name")}
            placeholder={t("Common.EnterFileName")}
            required
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
              if (error) setError("");
            }}
            error={error}
            data-autofocus
          />

          <Button style={{ marginTop: "1rem" }} type="submit">
            Rename
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

export function EditModal({
  opened,
  setOpened,
  mutate,
  setSelected,
  metadata,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
  mutate: () => void;
  setSelected: React.Dispatch<React.SetStateAction<FileMetadata | Directory | null>>;
  metadata: FileMetadata;
}) {
  const { t } = useTranslation();

  const [filename, setFilename] = useState(metadata.name);
  const [filetype, setFiletype] = useState<FileType>(metadata.metadata.type);
  const [error, setError] = useState("");

  async function editFile() {
    const metadataPath = metadata.path.replace(".pgn", ".info");
    const newMetadata = {
      type: filetype,
      tags: [],
    };
    await writeTextFile(metadataPath, JSON.stringify(newMetadata));

    const newPGNPath = metadata.path.replace(`${metadata.name}.pgn`, `${filename}.pgn`);

    await rename(metadata.path, newPGNPath);
    await rename(metadataPath.replace(".pgn", ".info"), newPGNPath.replace(".pgn", ".info"));

    mutate();
    setSelected((selected) =>
      selected?.path === metadata.path
        ? {
            ...metadata,
            name: filename,
            path: newPGNPath,
            numGames: metadata.numGames,
            numGamesKnown: metadata.numGamesKnown,
            metadata: newMetadata,
          }
        : selected,
    );

    setError("");
    setOpened(false);
  }

  return (
    <Modal opened={opened} onClose={() => setOpened(false)} title={t("Files.Edit.Title")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          editFile();
        }}
      >
        <Stack>
          <TextInput
            label={t("Common.Name")}
            placeholder={t("Common.EnterFileName")}
            required
            value={filename}
            onChange={(e) => setFilename(e.currentTarget.value)}
            error={error}
          />

          <Text fz="sm" fw="bold">
            {t("Files.FileType")}
          </Text>

          <SimpleGrid cols={3}>
            {FILE_TYPES.map((v) => (
              <GenericCard
                key={v.value}
                id={v.value}
                isSelected={filetype === v.value}
                setSelected={setFiletype}
                Header={<Text ta="center">{t(`Files.FileType.${v.label}`)}</Text>}
              />
            ))}
          </SimpleGrid>

          <Button style={{ marginTop: "1rem" }} type="submit">
            {t("Common.Edit")}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

export function CreateDirectoryModal({
  opened,
  setOpened,
  mutate,
  selected,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
  mutate: () => void;
  selected: FileMetadata | Directory | null;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const { documentDir } = useLoaderData({ from: "/files" });

  async function createDirectory() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("Common.RequireName"));
      return;
    }
    try {
      let targetDir = documentDir;
      if (selected) {
        if (selected.type === "directory") {
          targetDir = selected.path;
        } else {
          targetDir = await dirname(selected.path);
        }
      }
      const newPath = await resolve(targetDir, trimmed);
      if (await exists(newPath)) {
        setError(t("Files.CreateDirectory.AlreadyExists"));
        return;
      }
      await mkdir(newPath);
      mutate();
      setName("");
      setError("");
      setOpened(false);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={t("Files.CreateDirectory.Title")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createDirectory();
        }}
      >
        <Stack>
          <TextInput
            label={t("Common.Name")}
            placeholder={t("Files.CreateDirectory.Placeholder")}
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
              if (error) setError("");
            }}
            error={error}
            data-autofocus
          />
          <Button style={{ marginTop: "1rem" }} type="submit">
            {t("Common.Create")}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
