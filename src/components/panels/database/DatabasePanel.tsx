import {
  ActionIcon,
  Alert,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { Link } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr/immutable";
import { match } from "ts-pattern";
import { useStore } from "zustand";
import { commands } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentDbTabAtom,
  currentDbTypeAtom,
  currentLocalOptionsAtom,
  currentTabAtom,
  databaseMoveHealthSideAtom,
  defaultDatabaseSourceAtom,
  type DatabaseSourcePreference,
  lichessOptionsAtom,
  masterOptionsAtom,
  referenceDbAtom,
  sessionsAtom,
} from "@/state/atoms";
import { cancelDatabaseSearch, getDatabases, type Opening, searchPosition } from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { convertToNormalized, getLichessGames, getMasterGames } from "@/utils/lichess/api";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
import type { OpeningMoveHealthSidePreference } from "@/utils/openingMoveHealth";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import DatabaseLoader from "./DatabaseLoader";
import GamesTable from "./GamesTable";
import NoDatabaseWarning from "./NoDatabaseWarning";
import OpeningsTable, {
  openingMoveHealthSideOptions,
  type OpeningSort,
  openingSortOptions,
} from "./OpeningsTable";
import LichessOptionsPanel from "./options/LichessOptionsPanel";
import LocalOptionsPanel from "./options/LocalOptionsPanel";
import MasterOptionsPanel from "./options/MastersOptionsPanel";

type DBType =
  | { type: "local"; options: LocalOptions }
  | {
      type: "lch_all";
      options: LichessGamesOptions;
      fen: string;
      token: string;
    }
  | {
      type: "lch_master";
      options: MasterGamesOptions;
      fen: string;
      token: string;
    };

export type LocalOptions = {
  path: string | null;
  fen: string;
  type: "exact" | "partial";
  player: number | null;
  color: "white" | "black";
  start_date?: string;
  end_date?: string;
  result: "any" | "whitewon" | "draw" | "blackwon";
};

type MasterGamePlayerFilters = {
  whitePlayer: number | null;
  blackPlayer: number | null;
};

function sortOpenings(openings: Opening[]) {
  return openings.sort((a, b) => b.black + b.draw + b.white - (a.black + a.draw + a.white));
}

function isDatabaseSourcePreferenceEqual(a: DatabaseSourcePreference, b: DatabaseSourcePreference) {
  if (a.type !== b.type) return false;
  if (a.type === "local" && b.type === "local") return a.value === b.value;
  return true;
}

async function fetchOpening(
  db: DBType,
  tab: string,
  requestId: string,
  view: string,
  masterFilters: MasterGamePlayerFilters,
) {
  return match(db)
    .with({ type: "lch_all" }, async ({ fen, options, token }) => {
      const data = await getLichessGames(fen, options, token);
      return {
        openings: data.moves.map((move) => ({
          move: move.san,
          white: move.white,
          black: move.black,
          draw: move.draws,
        })),
        games: await convertToNormalized(data.topGames || data.recentGames || []),
      };
    })
    .with({ type: "lch_master" }, async ({ fen, options, token }) => {
      const data = await getMasterGames(fen, { topGames: 15, ...options }, token);
      return {
        openings: data.moves.map((move) => ({
          move: move.san,
          white: move.white,
          black: move.black,
          draw: move.draws,
        })),
        games: await convertToNormalized(data.topGames || data.recentGames || []),
      };
    })
    .with({ type: "local" }, async ({ options }) => {
      if (!options.path) throw Error("Missing reference database");
      const isMasterGamesView = view === "games";
      const positionData = await searchPosition(options, requestId, {
        includeOpenings: !isMasterGamesView,
        includeGames: isMasterGamesView,
        gameLimit: isMasterGamesView ? 80 : undefined,
        query: isMasterGamesView
          ? {
              player1: masterFilters.whitePlayer ?? undefined,
              player2: masterFilters.blackPlayer ?? undefined,
              sides: "WhiteBlack",
            }
          : undefined,
      });
      return {
        openings: sortOpenings(positionData[0]),
        games: positionData[1],
      };
    })
    .exhaustive();
}

function DatabasePanel() {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const [referenceDatabase, setReferenceDatabase] = useAtom(referenceDbAtom);
  const [defaultDatabaseSource, setDefaultDatabaseSource] = useAtom(defaultDatabaseSourceAtom);
  const sessions = useAtomValue(sessionsAtom);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const [lichessOptions, setLichessOptions] = useAtom(lichessOptionsAtom);
  const [masterOptions, setMasterOptions] = useAtom(masterOptionsAtom);
  const [localOptions, setLocalOptions] = useAtom(currentLocalOptionsAtom);
  const [db, setDb] = useAtom(currentDbTypeAtom);
  const [moveHealthSide, setMoveHealthSide] = useAtom(databaseMoveHealthSideAtom);
  const [openingSort, setOpeningSort] = useState<OpeningSort>("games");
  const [masterGamePlayerFilters, setMasterGamePlayerFilters] =
    useState<MasterGamePlayerFilters>({
      whitePlayer: null,
      blackPlayer: null,
    });
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const missingExplorerToken = db !== "local" && !explorerToken;

  const { data: databases } = useSWR(db === "local" ? "databases" : null, () => getDatabases());

  const dbSelectData = (databases ?? [])
    .filter((d) => d.type === "success")
    .map((d) => ({ value: d.file, label: d.title || d.filename }));

  useEffect(() => {
    if (db === "local") {
      setLocalOptions((q) => ({ ...q, fen: debouncedFen }));
    }
  }, [debouncedFen, setLocalOptions, setMasterOptions, setLichessOptions, db]);

  useEffect(() => {
    if (db === "local") {
      setLocalOptions((q) => ({ ...q, path: referenceDatabase }));
    }
  }, [referenceDatabase, setLocalOptions, db]);

  const dbType: DBType = match(db)
    .with("local", (v) => ({
      type: v,
      options: localOptions,
    }))
    .with("lch_all", (v) => ({
      type: v,
      options: lichessOptions,
      fen: debouncedFen,
      token: explorerToken ?? "",
    }))
    .with("lch_master", (v) => ({
      type: v,
      options: masterOptions,
      fen: debouncedFen,
      token: explorerToken ?? "",
    }))
    .exhaustive();

  const tab = useAtomValue(currentTabAtom);
  const [tabType, setTabType] = useAtom(currentDbTabAtom);
  const appliedDefaultRef = useRef(false);

  useEffect(() => {
    if (appliedDefaultRef.current) return;
    appliedDefaultRef.current = true;

    if (defaultDatabaseSource.type === "local") {
      setDb("local");
      if (defaultDatabaseSource.value) {
        setReferenceDatabase(defaultDatabaseSource.value);
      }
      return;
    }

    setDb(defaultDatabaseSource.type);
  }, [defaultDatabaseSource, setDb, setReferenceDatabase]);

  const selectedDefaultSource = useMemo(() => {
    if (db === "local") {
      return {
        type: "local" as const,
        value: referenceDatabase,
      };
    }

    return { type: db };
  }, [db, referenceDatabase]);
  const currentSelectionIsDefault = isDatabaseSourcePreferenceEqual(
    selectedDefaultSource,
    defaultDatabaseSource,
  );
  const canSaveDefault = db !== "local" || !!referenceDatabase;
  const databaseRequestId = useMemo(
    () =>
      [
        "database",
        tab?.value ?? "tab",
        db,
        debouncedFen,
        localOptions.path ?? "",
        localOptions.type,
        localOptions.player ?? "",
        localOptions.color,
        localOptions.start_date ?? "",
        localOptions.end_date ?? "",
        localOptions.result,
        tabType,
        masterGamePlayerFilters.whitePlayer ?? "",
        masterGamePlayerFilters.blackPlayer ?? "",
      ].join("|"),
    [db, debouncedFen, localOptions, masterGamePlayerFilters, tab?.value, tabType],
  );

  useEffect(() => {
    if (dbType.type !== "local" || tabType === "options" || missingExplorerToken) {
      return undefined;
    }

    return () => {
      void cancelDatabaseSearch(databaseRequestId);
    };
  }, [databaseRequestId, dbType.type, missingExplorerToken, tabType]);

  const {
    data: openingData,
    isLoading,
    error,
  } = useSWR(
    tabType !== "options" && !missingExplorerToken
      ? { dbType, requestId: databaseRequestId }
      : null,
    async ({ dbType, requestId }) => {
      return fetchOpening(
        dbType,
        tab?.value || "",
        requestId,
        tabType,
        masterGamePlayerFilters,
      );
    },
  );

  const grandTotal = openingData?.openings?.reduce(
    (acc, curr) => acc + curr.black + curr.white + curr.draw,
    0,
  );

  const header = (
    <>
      <Group justify="space-between" w="100%" wrap="wrap">
        <Group>
          <SegmentedControl
            data={[
              { label: t("Board.Database.Local"), value: "local" },
              { label: t("Board.Database.LichessAll"), value: "lch_all" },
              { label: t("Board.Database.LichessMaster"), value: "lch_master" },
            ]}
            value={db}
            onChange={(value) => setDb(value as "local" | "lch_all" | "lch_master")}
          />

          {db === "local" && (
            <Select
              data={dbSelectData}
              value={referenceDatabase}
              onChange={async (value) => {
                await commands.clearGames();
                setReferenceDatabase(value);
              }}
              placeholder={t("Board.Database.SelectReference")}
              size="sm"
              flex={1}
              maw={200}
              allowDeselect={false}
            />
          )}
          <Tooltip
            label={
              currentSelectionIsDefault
                ? "Current default database source"
                : "Make this the default database source"
            }
          >
            <ActionIcon
              variant="default"
              size="lg"
              disabled={!canSaveDefault}
              onClick={() => setDefaultDatabaseSource(selectedDefaultSource)}
            >
              {currentSelectionIsDefault ? (
                <IconStarFilled size="1rem" />
              ) : (
                <IconStar size="1rem" />
              )}
            </ActionIcon>
          </Tooltip>
        </Group>

        {tabType !== "options" && (
          <Group gap="xs" wrap="nowrap">
            {tabType === "stats" && (
              <>
                <Tooltip label="Evaluate move strength for this side">
                  <Select
                    data={openingMoveHealthSideOptions}
                    value={moveHealthSide}
                    onChange={(value) =>
                      setMoveHealthSide((value as OpeningMoveHealthSidePreference) ?? "sideToMove")
                    }
                    size="sm"
                    w={145}
                    allowDeselect={false}
                  />
                </Tooltip>
                <Select
                  data={openingSortOptions}
                  value={openingSort}
                  onChange={(value) => setOpeningSort((value as OpeningSort) ?? "games")}
                  size="sm"
                  w={160}
                  allowDeselect={false}
                />
              </>
            )}
            <Text style={{ whiteSpace: "nowrap" }}>
              {t("Board.Database.Matches", {
                matches: formatNumber(Math.max(grandTotal || 0, openingData?.games.length || 0)),
              })}
            </Text>
          </Group>
        )}
      </Group>
      <DatabaseLoader
        isLoading={isLoading}
        tab={dbType.type === "local" ? databaseRequestId : (tab?.value ?? null)}
      />
    </>
  );

  return (
    <Stack h="100%" gap={0}>
      <Tabs
        defaultValue="stats"
        orientation="vertical"
        placement="right"
        value={tabType}
        onChange={(v) => setTabType(v!)}
        display="flex"
        flex={1}
        style={{ overflow: "hidden" }}
      >
        <Tabs.List>
          <Tabs.Tab
            value="stats"
            disabled={dbType.type === "local" && dbType.options.type === "partial"}
          >
            {t("Board.Database.Stats")}
          </Tabs.Tab>
          <Tabs.Tab value="games">Master games</Tabs.Tab>
          <Tabs.Tab value="options">{t("Board.Database.Options")}</Tabs.Tab>
        </Tabs.List>

        <PanelWithError
          value="stats"
          error={error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
        >
          <OpeningsTable
            openings={openingData?.openings || []}
            loading={isLoading}
            sortBy={openingSort}
            healthSidePreference={moveHealthSide}
          />
        </PanelWithError>
        <PanelWithError
          value="games"
          error={error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
        >
          <GamesTable
            games={openingData?.games || []}
            loading={isLoading}
            databasePath={dbType.type === "local" ? dbType.options.path : null}
            whitePlayer={masterGamePlayerFilters.whitePlayer}
            blackPlayer={masterGamePlayerFilters.blackPlayer}
            onWhitePlayerChange={(whitePlayer) =>
              setMasterGamePlayerFilters((current) => ({ ...current, whitePlayer }))
            }
            onBlackPlayerChange={(blackPlayer) =>
              setMasterGamePlayerFilters((current) => ({ ...current, blackPlayer }))
            }
          />
        </PanelWithError>
        <PanelWithError
          value="options"
          error={error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
        >
          <ScrollArea flex={1} offsetScrollbars pt="sm">
            {match(db)
              .with("local", () => <LocalOptionsPanel boardFen={debouncedFen} />)
              .with("lch_all", () => <LichessOptionsPanel />)
              .with("lch_master", () => <MasterOptionsPanel />)
              .exhaustive()}
          </ScrollArea>
        </PanelWithError>
      </Tabs>
    </Stack>
  );
}

function PanelWithError(props: {
  value: string;
  error: string;
  type: string;
  header: React.ReactNode;
  children: React.ReactNode;
  missingExplorerToken: boolean;
}) {
  const referenceDatabase = useAtomValue(referenceDbAtom);
  const { t } = useTranslation();
  let children = props.children;
  if (props.type === "local" && !referenceDatabase) {
    children = <NoDatabaseWarning />;
  }
  if (props.missingExplorerToken && props.type !== "local") {
    children = (
      <Alert color="yellow">
        {t("Board.Database.ExplorerAuthRequired1")} <Link to="/accounts">Users</Link>{" "}
        {t("Board.Database.ExplorerAuthRequired2")}
      </Alert>
    );
  }
  if (props.error && props.type !== "local") {
    children = <Alert color="red">{props.error.toString()}</Alert>;
  }

  return (
    <Tabs.Panel
      py="xs"
      px="sm"
      value={props.value}
      flex={1}
      style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      {props.header}
      {children}
    </Tabs.Panel>
  );
}

export default memo(DatabasePanel);
