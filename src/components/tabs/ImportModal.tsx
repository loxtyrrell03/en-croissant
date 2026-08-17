import {
  Button,
  Checkbox,
  Divider,
  FileInput,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import { resolve, tempDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { makeFen, parseFen } from "chessops/fen";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import { headersToPGN, parsePGN } from "@/utils/chess";
import { getChesscomGame } from "@/utils/chess.com/api";
import { chessopsError } from "@/utils/chessops";
import { createFile, openFile } from "@/utils/files";
import { getLichessGame } from "@/utils/lichess/api";
import { createTab, type Tab } from "@/utils/tabs";
import { getGameName } from "@/utils/treeReducer";
import GenericCard from "../common/GenericCard";
import type { PgnFileType } from "../files/file";

type ImportType = "PGN" | "Link" | "FEN";

const FILE_TYPES = [
  { label: "Files.FileType.Game", value: "game" },
  { label: "Files.FileType.Repertoire", value: "repertoire" },
  { label: "Files.FileType.Tournament", value: "tournament" },
  { label: "Files.FileType.Puzzle", value: "puzzle" },
  { label: "Files.FileType.Other", value: "other" },
] as const;

export default function ImportModal({
  openModal,
  setOpenModal,
  setTabs,
  setActiveTab,
}: {
  openModal: boolean;
  setOpenModal: React.Dispatch<React.SetStateAction<boolean>>;
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const { t } = useTranslation();
  const [pgn, setPgn] = useState("");
  const [fen, setFen] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [importType, setImportType] = useState<ImportType>("PGN");
  const [filetype, setFiletype] = useState<PgnFileType>("game");
  const [loading, setLoading] = useState(false);
  const [fenError, setFenError] = useState("");

  const [save, setSave] = useState(false);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const { documentDir } = useLoaderData({ from: "/home" });
  const navigate = useNavigate();

  async function handleSubmit() {
    setLoading(true);
    let imported = false;
    if (importType === "PGN") {
      if (file || pgn) {
        if (file) {
          if (save) {
            const fileContent = await readTextFile(file);
            const newFile = await createFile({
              filename,
              filetype,
              pgn: fileContent,
              dir: documentDir,
            });
            if (newFile.isErr) {
              setError(newFile.error.message);
              setLoading(false);
              return;
            }
            await openFile(newFile.value, setTabs, setActiveTab);
          } else {
            await openFile(file, setTabs, setActiveTab);
          }
          imported = true;
        } else {
          const tempFile = await resolve(await tempDir(), `import_${Date.now()}.pgn`);
          await writeTextFile(tempFile, pgn);
          await openFile(tempFile, setTabs, setActiveTab);
          imported = true;
        }
      }
    } else if (importType === "Link") {
      if (!link) {
        setLoading(false);
        return;
      }
      let pgn = "";
      if (link.includes("chess.com")) {
        const res = await getChesscomGame(link);
        if (res === null) {
          setLoading(false);
          return;
        }
        pgn = res;
      } else if (link.includes("lichess")) {
        const excludedPathParts = ["game", "export", "white", "black"];
        const gameId = new URL(link).pathname
          .split("/")
          .find((x) => x && !excludedPathParts.includes(x));
        if (!gameId) {
          setLoading(false);
          return;
        }
        pgn = await getLichessGame(gameId);
      }

      const tree = await parsePGN(pgn);
      await createTab({
        tab: {
          name: getGameName(tree.headers),
          type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn,
        initialState: tree,
        gameOrigin: {
          kind: "none",
        },
      });
      imported = true;
    } else if (importType === "FEN") {
      const res = parseFen(fen.trim());
      if (res.isErr) {
        setFenError(chessopsError(res.error));
        setLoading(false);
        return;
      }
      setFenError("");
      const parsedFen = makeFen(res.value);
      const name = t("Home.Card.AnalysisBoard.Title");
      await createTab({
        tab: {
          name,
          type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn: headersToPGN({
          id: 0,
          fen: parsedFen,
          black: "",
          white: "",
          result: "*",
          event: name,
          site: "",
          orientation: "white",
        }),
        gameOrigin: {
          kind: "none",
        },
      });
      imported = true;
    }
    if (imported) {
      setOpenModal(false);
      navigate({ to: "/" });
    }
    setLoading(false);
  }

  const Input = match(importType)
    .with("PGN", () => (
      <Stack>
        <div>
          <FileInput
            label={t("Common.PGNFile")}
            description={t("Import.PGN.ClickToSelect")}
            onClick={async () => {
              const selected = (await open({
                multiple: false,

                filters: [
                  {
                    name: t("Common.PGNFile"),
                    extensions: ["pgn"],
                  },
                ],
              })) as string;
              setFile(selected);
              setFilename(
                selected
                  .split(/(\\|\/)/g)
                  .pop()
                  ?.replace(".pgn", "") || "",
              );
            }}
            value={new File([new Blob()], file || "")}
            onChange={(e) => {
              if (e === null) {
                setFile(null);
                setFilename("");
              }
            }}
            disabled={pgn !== ""}
          />
          <Divider pt="xs" label={t("Import.Or")} labelPosition="center" />
          <Textarea
            value={pgn}
            disabled={file !== null}
            onChange={(event) => setPgn(event.currentTarget.value)}
            label={t("Common.PGNGame")}
            data-autofocus
            rows={8}
          />
        </div>

        <Checkbox
          label={t("Import.SaveToCollection")}
          checked={save}
          onChange={(e) => setSave(e.currentTarget.checked)}
        />

        {save && (
          <>
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
                  Header={<Text ta="center">{t(v.label)}</Text>}
                />
              ))}
            </SimpleGrid>
          </>
        )}
      </Stack>
    ))
    .with("Link", () => (
      <TextInput
        value={link}
        onChange={(event) => setLink(event.currentTarget.value)}
        label={t("Import.GameURL")}
        data-autofocus
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
      />
    ))
    .with("FEN", () => (
      <TextInput
        value={fen}
        onChange={(event) => setFen(event.currentTarget.value)}
        error={fenError}
        label="FEN"
        data-autofocus
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
      />
    ))
    .exhaustive();

  const disabled = match(importType)
    .with("PGN", () => !pgn && !file)
    .with("Link", () => !link)
    .with("FEN", () => !fen)
    .exhaustive();

  return (
    <Modal
      opened={openModal}
      onClose={() => setOpenModal(false)}
      title={t("Home.Card.ImportGame.Title")}
    >
      <Group grow mb="sm">
        <GenericCard
          id={"PGN"}
          isSelected={importType === "PGN"}
          setSelected={setImportType}
          Header={<Text ta="center">PGN</Text>}
        />

        <GenericCard
          id={"Link"}
          isSelected={importType === "Link"}
          setSelected={setImportType}
          Header={<Text ta="center">{t("Import.Online")}</Text>}
        />

        <GenericCard
          id={"FEN"}
          isSelected={importType === "FEN"}
          setSelected={setImportType}
          Header={<Text ta="center">FEN</Text>}
        />
      </Group>

      {Input}

      <Button
        fullWidth
        mt="md"
        radius="md"
        loading={loading}
        disabled={disabled}
        onClick={handleSubmit}
      >
        {loading ? t("Import.Importing") : t("Home.Card.ImportGame.Button")}
      </Button>
    </Modal>
  );
}
