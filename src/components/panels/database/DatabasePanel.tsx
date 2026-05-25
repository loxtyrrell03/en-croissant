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
import equal from "fast-deep-equal";
import { match } from "ts-pattern";
import { useStore } from "zustand";
import { commands, type Player } from "@/bindings";
import { usePanelDensity } from "@/components/common/ResponsivePanel";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import DatabaseFolderSelect from "@/components/common/DatabaseFolderSelect";
import {
  currentDbTabAtom,
  currentDbTypeAtom,
  currentLocalOptionsAtom,
  currentTabAtom,
  databasePanelSettingsByFileAtom,
  databaseMoveHealthSideAtom,
  defaultDatabaseSourceAtom,
  type DatabasePanelFileSettings,
  type DatabaseSourcePreference,
  lichessOptionsAtom,
  masterOptionsAtom,
  referenceDbAtom,
  sessionsAtom,
  type StoredDatabaseLocalOptions,
} from "@/state/atoms";
import {
  cancelDatabaseSearch,
  getDatabases,
  getDatabaseSelectData,
  getLocalResultPerspective,
  type Opening,
  query_players,
  searchPosition,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { convertToNormalized, getLichessGames, getMasterGames } from "@/utils/lichess/api";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
import type { OpeningMoveHealthSidePreference } from "@/utils/openingMoveHealth";
import { getTabWorkspaceKey } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import DatabaseLoader from "./DatabaseLoader";
import { DatabasePerspectiveControls } from "./DatabasePerspectiveControls";
import GamesTable from "./GamesTable";
import { MoveStrengthSettingsButton } from "./MoveStrengthSettingsButton";
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
  playerName?: string;
  color: "white" | "black";
  start_date?: string;
  end_date?: string;
  result: "any" | "whitewon" | "draw" | "blackwon";
};

type MasterGamePlayerFilters = {
  whitePlayer: number | null;
  blackPlayer: number | null;
  anyPlayerText: string;
  anyPlayerId?: number | null;
};

const MASTER_GAME_DEFAULT_LIMIT = 80;
const MASTER_GAME_PLAYER_TEXT_LIMIT = 5_000;

function sortOpenings(openings: Opening[]) {
  return openings.sort((a, b) => b.black + b.draw + b.white - (a.black + a.draw + a.white));
}

function isDatabaseSourcePreferenceEqual(a: DatabaseSourcePreference, b: DatabaseSourcePreference) {
  if (a.type !== b.type) return false;
  if (a.type === "local" && b.type === "local") return a.value === b.value;
  return true;
}

async function resolveMasterGameTextPlayer(databasePath: string, searchText: string) {
  const queries = getPlayerSearchQueries(searchText);
  if (queries.length === 0) return null;

  const players: Player[] = [];
  const seen = new Set<number>();
  for (const query of queries) {
    const result = await query_players(databasePath, {
      name: query,
      options: {
        page: 1,
        pageSize: 12,
        skipCount: true,
        sort: "elo",
        direction: "desc",
      },
    });
    for (const player of result.data) {
      if (!seen.has(player.id)) {
        players.push(player);
        seen.add(player.id);
      }
    }
  }

  const normalizedSearch = normalizePlayerText(searchText);
  const tokens = normalizedSearch.split(" ").filter(Boolean);
  const exact = players.find(
    (player) => normalizePlayerText(player.name ?? "") === normalizedSearch,
  );
  if (exact) return exact;

  return (
    players.find((player) => {
      const normalizedName = normalizePlayerText(player.name ?? "");
      return tokens.length > 0 && tokens.every((token) => normalizedName.includes(token));
    }) ?? null
  );
}

function getPlayerSearchQueries(searchText: string) {
  const normalized = normalizePlayerText(searchText);
  if (normalized.length < 3) return [];

  const queries = new Set([searchText.trim()]);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 2 && !searchText.includes(",")) {
    queries.add(`${tokens[1]}, ${tokens[0]}`);
  }
  for (const token of tokens) {
    if (token.length >= 3) queries.add(token);
  }

  return Array.from(queries).filter(Boolean);
}

function normalizePlayerText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function toStoredLocalOptions(options: LocalOptions): StoredDatabaseLocalOptions {
  return {
    type: options.type,
    player: options.player,
    playerName: options.playerName,
    color: options.color,
    start_date: options.start_date,
    end_date: options.end_date,
    result: options.result,
  };
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
      const anyPlayerId = masterFilters.anyPlayerId ?? null;
      const hasPlayerFilter =
        !!anyPlayerId || !!masterFilters.whitePlayer || !!masterFilters.blackPlayer;
      const playerQuery = anyPlayerId
        ? {
            player1: anyPlayerId,
            sides: "Any" as const,
          }
        : {
            player1: masterFilters.whitePlayer ?? undefined,
            player2: masterFilters.blackPlayer ?? undefined,
            sides: "WhiteBlack" as const,
          };
      const positionData = await searchPosition(options, requestId, {
        includeOpenings: !isMasterGamesView,
        includeGames: isMasterGamesView,
        gameLimit: isMasterGamesView
          ? hasPlayerFilter
            ? MASTER_GAME_PLAYER_TEXT_LIMIT
            : MASTER_GAME_DEFAULT_LIMIT
          : undefined,
        query: isMasterGamesView && hasPlayerFilter ? playerQuery : undefined,
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
  const panelDensity = usePanelDensity();
  const dense = panelDensity === "dense";
  const compact = panelDensity !== "regular";
  const controlSize = compact ? "xs" : "sm";
  const tableDensity = dense ? "dense" : compact ? "compact" : "regular";

  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const [referenceDatabase, setReferenceDatabase] = useAtom(referenceDbAtom);
  const [defaultDatabaseSource, setDefaultDatabaseSource] = useAtom(defaultDatabaseSourceAtom);
  const [databasePanelSettingsByFile, setDatabasePanelSettingsByFile] = useAtom(
    databasePanelSettingsByFileAtom,
  );
  const tab = useAtomValue(currentTabAtom);
  const settingsKey = useMemo(() => getTabWorkspaceKey(tab), [tab]);
  const savedPanelSettings = settingsKey ? databasePanelSettingsByFile[settingsKey] : undefined;
  const sessions = useAtomValue(sessionsAtom);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const [lichessOptions, setLichessOptions] = useAtom(lichessOptionsAtom);
  const [masterOptions, setMasterOptions] = useAtom(masterOptionsAtom);
  const [localOptions, setLocalOptions] = useAtom(currentLocalOptionsAtom);
  const [db, setDb] = useAtom(currentDbTypeAtom);
  const [moveHealthSide, setMoveHealthSide] = useAtom(databaseMoveHealthSideAtom);
  const [openingSort, setOpeningSort] = useState<OpeningSort>("games");
  const [masterGamePlayerFilters, setMasterGamePlayerFilters] = useState<MasterGamePlayerFilters>({
    whitePlayer: null,
    blackPlayer: null,
    anyPlayerText: "",
  });
  const [debouncedMasterGamePlayerText] = useDebouncedValue(
    masterGamePlayerFilters.anyPlayerText,
    250,
  );
  const shouldResolveMasterGameTextPlayer =
    db === "local" &&
    !!referenceDatabase &&
    normalizePlayerText(debouncedMasterGamePlayerText).length >= 3;
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const missingExplorerToken = db !== "local" && !explorerToken;

  const { data: databases } = useSWR(db === "local" ? "databases" : null, () => getDatabases());
  const { data: masterGameTextPlayer } = useSWR(
    shouldResolveMasterGameTextPlayer
      ? ["master-game-text-player", referenceDatabase, debouncedMasterGamePlayerText]
      : null,
    async ([, databasePath, searchText]) => {
      return resolveMasterGameTextPlayer(databasePath!, searchText);
    },
  );
  const { data: masterWhitePlayer } = useSWR(
    db === "local" && referenceDatabase && masterGamePlayerFilters.whitePlayer
      ? ["master-white-player", referenceDatabase, masterGamePlayerFilters.whitePlayer]
      : null,
    async ([, databasePath, playerId]) => {
      return unwrap(await commands.getPlayer(databasePath!, playerId!));
    },
  );
  const { data: masterBlackPlayer } = useSWR(
    db === "local" && referenceDatabase && masterGamePlayerFilters.blackPlayer
      ? ["master-black-player", referenceDatabase, masterGamePlayerFilters.blackPlayer]
      : null,
    async ([, databasePath, playerId]) => {
      return unwrap(await commands.getPlayer(databasePath!, playerId!));
    },
  );
  const masterRepertoirePlayer =
    masterGameTextPlayer ?? masterWhitePlayer ?? masterBlackPlayer ?? null;
  const masterRepertoirePlayerSide: "white" | "black" | "any" = masterGameTextPlayer
    ? "any"
    : masterWhitePlayer
      ? "white"
      : masterBlackPlayer
        ? "black"
        : "any";

  const dbSelectData = getDatabaseSelectData(databases ?? []);

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

  const [tabType, setTabType] = useAtom(currentDbTabAtom);
  const appliedSettingsKeyRef = useRef<string | null>(null);
  const skipNextPersistKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const hydrationKey = settingsKey ?? "__default-database-settings__";
    if (appliedSettingsKeyRef.current === hydrationKey) return;
    appliedSettingsKeyRef.current = hydrationKey;
    if (settingsKey) skipNextPersistKeyRef.current = settingsKey;

    const source = savedPanelSettings?.source ?? defaultDatabaseSource;
    if (source.type === "local") {
      setDb("local");
      setReferenceDatabase(source.value ?? null);
    } else {
      setDb(source.type);
    }

    if (savedPanelSettings) {
      setLocalOptions((current) => ({
        ...current,
        ...savedPanelSettings.localOptions,
      }));
      setLichessOptions(savedPanelSettings.lichessOptions);
      setMasterOptions(savedPanelSettings.masterOptions);
      setMoveHealthSide(savedPanelSettings.moveHealthSide);
      setTabType(savedPanelSettings.tabType);
    }
  }, [
    defaultDatabaseSource,
    savedPanelSettings,
    setDb,
    setLichessOptions,
    setLocalOptions,
    setMasterOptions,
    setMoveHealthSide,
    setReferenceDatabase,
    setTabType,
    settingsKey,
  ]);

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

  useEffect(() => {
    if (!settingsKey || appliedSettingsKeyRef.current !== settingsKey) return;
    if (skipNextPersistKeyRef.current === settingsKey) {
      skipNextPersistKeyRef.current = null;
      return;
    }

    const nextSettings: DatabasePanelFileSettings = {
      source: selectedDefaultSource,
      localOptions: toStoredLocalOptions(localOptions),
      lichessOptions,
      masterOptions,
      moveHealthSide,
      tabType,
    };

    setDatabasePanelSettingsByFile((current) => {
      if (equal(current[settingsKey], nextSettings)) return current;
      return {
        ...current,
        [settingsKey]: nextSettings,
      };
    });
  }, [
    lichessOptions,
    localOptions,
    masterOptions,
    moveHealthSide,
    selectedDefaultSource,
    setDatabasePanelSettingsByFile,
    settingsKey,
    tabType,
  ]);

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
        localOptions.playerName ?? "",
        localOptions.color,
        localOptions.start_date ?? "",
        localOptions.end_date ?? "",
        localOptions.result,
        tabType,
        masterGamePlayerFilters.whitePlayer ?? "",
        masterGamePlayerFilters.blackPlayer ?? "",
        masterGameTextPlayer?.id ?? "",
      ].join("|"),
    [
      db,
      debouncedFen,
      localOptions,
      masterGamePlayerFilters.whitePlayer,
      masterGamePlayerFilters.blackPlayer,
      masterGameTextPlayer?.id,
      tab?.value,
      tabType,
    ],
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
      return fetchOpening(dbType, tab?.value || "", requestId, tabType, {
        ...masterGamePlayerFilters,
        anyPlayerText: debouncedMasterGamePlayerText,
        anyPlayerId: masterGameTextPlayer?.id ?? null,
      });
    },
  );

  const grandTotal = openingData?.openings?.reduce(
    (acc, curr) => acc + curr.black + curr.white + curr.draw,
    0,
  );
  const resultPerspective =
    dbType.type === "local" ? getLocalResultPerspective(localOptions) : null;

  const header = (
    <>
      <Group justify="space-between" w="100%" wrap="wrap" gap={dense ? 4 : "xs"}>
        <Group gap={dense ? 4 : "xs"} wrap="wrap">
          <SegmentedControl
            size={controlSize}
            data={[
              { label: t("Board.Database.Local"), value: "local" },
              { label: t("Board.Database.LichessAll"), value: "lch_all" },
              { label: t("Board.Database.LichessMaster"), value: "lch_master" },
            ]}
            value={db}
            onChange={(value) => setDb(value as "local" | "lch_all" | "lch_master")}
          />

          {db === "local" && (
            <DatabaseFolderSelect
              data={dbSelectData}
              value={referenceDatabase}
              onChange={async (value) => {
                await commands.clearGames();
                setReferenceDatabase(value);
              }}
              placeholder={t("Board.Database.SelectReference")}
              size={controlSize}
              flex={1}
              maxWidth={dense ? 150 : 200}
              minWidth={dense ? 116 : 150}
              allowDeselect={false}
            />
          )}
          {db === "local" && (
            <DatabasePerspectiveControls
              databasePath={referenceDatabase}
              player={localOptions.player}
              playerName={localOptions.playerName}
              color={localOptions.color}
              onPlayerChange={(player) => setLocalOptions((q) => ({ ...q, player }))}
              onPlayerNameChange={(playerName) => setLocalOptions((q) => ({ ...q, playerName }))}
              onColorChange={(color) => setLocalOptions((q) => ({ ...q, color }))}
              size={controlSize}
              playerWidth={dense ? 128 : 165}
              colorWidth={dense ? 116 : 132}
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
              size={compact ? "sm" : "lg"}
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
          <Group gap={dense ? 4 : "xs"} wrap="wrap">
            {tabType === "stats" && (
              <>
                <Tooltip label="Evaluate move strength for this side">
                  <Select
                    data={openingMoveHealthSideOptions}
                    value={moveHealthSide}
                    onChange={(value) =>
                      setMoveHealthSide((value as OpeningMoveHealthSidePreference) ?? "sideToMove")
                    }
                    size={controlSize}
                    w={dense ? 118 : 145}
                    allowDeselect={false}
                  />
                </Tooltip>
                <Select
                  data={openingSortOptions}
                  value={openingSort}
                  onChange={(value) => setOpeningSort((value as OpeningSort) ?? "games")}
                  size={controlSize}
                  w={dense ? 126 : 160}
                  allowDeselect={false}
                />
                <MoveStrengthSettingsButton size={compact ? "sm" : "lg"} />
              </>
            )}
            <Text fz={compact ? "xs" : "sm"} style={{ whiteSpace: "nowrap" }}>
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
        orientation={dense ? "horizontal" : "vertical"}
        placement={dense ? undefined : "right"}
        value={tabType}
        onChange={(v) => setTabType(v!)}
        display="flex"
        flex={1}
        style={{
          overflow: "hidden",
          flexDirection: dense ? "column" : undefined,
        }}
      >
        <Tabs.List grow={dense}>
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
            density={tableDensity}
            openings={openingData?.openings || []}
            loading={isLoading}
            sortBy={openingSort}
            onSortChange={setOpeningSort}
            healthSidePreference={moveHealthSide}
            resultPerspective={resultPerspective}
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
            searchText={masterGamePlayerFilters.anyPlayerText}
            onSearchTextChange={(anyPlayerText) =>
              setMasterGamePlayerFilters((current) => ({ ...current, anyPlayerText }))
            }
            repertoirePlayer={
              masterRepertoirePlayer?.name
                ? { id: masterRepertoirePlayer.id, name: masterRepertoirePlayer.name }
                : null
            }
            repertoirePlayerSide={masterRepertoirePlayerSide}
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
  const panelDensity = usePanelDensity();
  const compact = panelDensity !== "regular";
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
      py={compact ? 4 : "xs"}
      px={compact ? 6 : "sm"}
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
