import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  NumberInput,
  Progress,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconArrowRight,
  IconCheck,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconSparkles,
  IconTarget,
  IconX,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { isNormal, makeSquare } from "chessops";
import { parseSan } from "chessops/san";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import { usePanelDensity } from "@/components/common/ResponsivePanel";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  comparePanelSettingsByFileAtom,
  currentBoardPreviewShapesAtom,
  currentLocalOptionsAtom,
  currentOpponentPrepAtom,
  currentTabAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  referenceDbAtom,
  sessionsAtom,
  type OpponentPrepState,
  type StoredDatabaseLocalOptions,
} from "@/state/atoms";
import {
  cancelDatabaseSearch,
  getDatabases,
  searchPosition,
  type Opening,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { formatNumber } from "@/utils/format";
import { getLichessGames, getMasterGames } from "@/utils/lichess/api";
import { isPrefix } from "@/utils/misc";
import {
  findFirstOpponentBranch,
  findLastOpponentBranch,
  findOpponentPrepStart,
  choosePrepBuilderMove,
  getFenTurn,
  getLineSans,
  getOpeningTotal,
  getOpponentPrepBranchKey,
  getOpponentPrepBranchStats,
  getOpponentPrepMoveRows,
  getPrepBuilderBranchValue,
  getPrepBuilderReplyPolicy,
  getPrepBuilderStopReason,
  getPrepBuilderUserResponseChildIndex,
  hasPrepBuilderDatabaseCandidates,
  normalizePrepBuilderSettings,
  oppositePrepColor,
  pathExists,
  sortOpponentPrepOpenings,
  type PrepBuilderEngineMove,
  type PrepBuilderMoveChoice,
  type PrepBuilderSettings,
  type OpponentPrepBranchStats,
  type OpponentPrepMoveRow,
} from "@/utils/opponentPrep";
import { getTabWorkspaceKey, saveToFile } from "@/utils/tabs";
import { positionFromFen } from "@/utils/chessops";
import { getTreeStructureHash } from "@/utils/treeReducer";
import { queryChessDbMoves } from "@/utils/chessdb/api";
import { queryLichessCloudMoves } from "@/utils/lichess/api";
import { DatabasePerspectiveControls } from "../database/DatabasePerspectiveControls";

const DEFAULT_PREP_MIN_GAMES = 2;
const DEFAULT_PREP_MOVE_LIMIT = 8;
const LICHESS_ALL_SOURCE = "online:lichess-all";
const LICHESS_MASTER_SOURCE = "online:lichess-master";

type PrepCandidateMoveRow = Opening & {
  key: string;
  total: number;
  share: number;
};

type PrepBuilderStatus = {
  phase: string;
  addedMoves: number;
  visitedPositions: number;
  stoppedLines: number;
};

type PrepBuilderQueueItem = {
  path: number[];
  branchShare: number;
  depthShare: number;
  branchValue?: number;
  ply: number;
};

function getPrepCandidateRows({
  fen,
  openings,
  minGames,
  moveLimit,
}: {
  fen: string;
  openings: Opening[];
  minGames: number;
  moveLimit: number;
}): PrepCandidateMoveRow[] {
  const sorted = sortOpponentPrepOpenings(openings, minGames, moveLimit);
  const totalGames = sorted.reduce((sum, opening) => sum + getOpeningTotal(opening), 0);

  return sorted.map((opening) => ({
    ...opening,
    key: getOpponentPrepBranchKey(fen, opening.move),
    total: getOpeningTotal(opening),
    share: totalGames > 0 ? getOpeningTotal(opening) / totalGames : 0,
  }));
}

function OpponentPrepPanel() {
  const store = useContext(TreeStateContext)!;
  const currentNode = useStore(store, (s) => s.currentNode());
  const currentFen = currentNode.fen;
  const currentPath = useStore(store, (s) => s.position);
  const root = useStore(store, (s) => s.root);
  const [prep, setPrep] = useAtom(currentOpponentPrepAtom);
  const currentLocalOptions = useAtomValue(currentLocalOptionsAtom);
  const lichessOptions = useAtomValue(lichessOptionsAtom);
  const masterOptions = useAtomValue(masterOptionsAtom);
  const compareSettingsByFile = useAtomValue(comparePanelSettingsByFileAtom);
  const referenceDb = useAtomValue(referenceDbAtom);
  const sessions = useAtomValue(sessionsAtom);
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const { documentDir } = useLoaderData({ from: "/" });
  const setBoardPreviewShapes = useSetAtom(currentBoardPreviewShapesAtom);
  const panelDensity = usePanelDensity();
  const compact = panelDensity !== "regular";
  const dense = panelDensity === "dense";
  const [advancing, setAdvancing] = useState(false);
  const [commonMoving, setCommonMoving] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderRunning, setBuilderRunning] = useState(false);
  const [builderNeedsSave, setBuilderNeedsSave] = useState(false);
  const [savingBuilderResult, setSavingBuilderResult] = useState<"new" | "overwrite" | null>(null);
  const [builderStatus, setBuilderStatus] = useState<PrepBuilderStatus | null>(null);
  const moveCacheRef = useRef(new Map<string, Opening[]>());
  const builderReferenceCacheRef = useRef(new Map<string, Opening[]>());
  const builderCancelRef = useRef(false);
  const seededRef = useRef(false);
  const settingsKey = useMemo(() => getTabWorkspaceKey(currentTab), [currentTab]);
  const savedCompareSettings = settingsKey ? compareSettingsByFile[settingsKey] : undefined;
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const prepMode = prep.mode ?? "player";
  const prepSource = prep.source ?? "local";
  const builderSettings = useMemo(() => normalizePrepBuilderSettings(prep.builder), [prep.builder]);
  const { data: databases } = useSWR("databases", () => getDatabases());
  const localDatabases = useMemo(
    () =>
      (databases ?? []).filter(
        (database): database is SuccessDatabaseInfo => database.type === "success",
      ),
    [databases],
  );
  const sourceOptions = useMemo(
    () => [
      ...localDatabases.map((database) => ({
        value: database.file,
        label: database.title || database.filename,
      })),
      {
        value: LICHESS_ALL_SOURCE,
        label: "Lichess All",
      },
      {
        value: LICHESS_MASTER_SOURCE,
        label: "Lichess Masters",
      },
    ],
    [localDatabases],
  );
  const selectedDatabase = useMemo(
    () => localDatabases.find((database) => database.file === prep.databasePath) ?? null,
    [localDatabases, prep.databasePath],
  );
  const rootPath = useMemo(() => {
    const candidate = prep.rootPath ?? [];
    return pathExists(root, candidate) ? candidate : [];
  }, [prep.rootPath, root]);
  const isInsidePrepTree = isPrefix(rootPath, currentPath);
  const opponentToMove = getFenTurn(currentFen) === prep.color;
  const userColor = oppositePrepColor(prep.color);
  const hasPlayer = Boolean(prep.player) || prep.playerName.trim().length >= 3;
  const missingExplorerToken = prepSource !== "local" && !explorerToken;
  const sourceReady = prepSource === "local" ? Boolean(prep.databasePath) : !missingExplorerToken;
  const targetReady = prepMode === "general" || hasPlayer;
  const configReady = sourceReady && targetReady;
  const sourceValue =
    prepSource === "lch_all"
      ? LICHESS_ALL_SOURCE
      : prepSource === "lch_master"
        ? LICHESS_MASTER_SOURCE
        : prep.databasePath;
  const queryScope = useMemo(
    () =>
      JSON.stringify({
        mode: prepMode,
        source: prepSource,
        databasePath: prep.databasePath,
        player: prepMode === "player" ? prep.player : null,
        playerName: prepMode === "player" ? prep.playerName.trim() : "",
        color: prep.color,
        startDate: prep.start_date ?? "",
        endDate: prep.end_date ?? "",
        result: prep.result,
        lichessOptions:
          prepSource === "lch_all"
            ? {
                ...lichessOptions,
                player: undefined,
                moves: Math.max(12, prep.moveLimit),
              }
            : null,
        masterOptions:
          prepSource === "lch_master"
            ? {
                ...masterOptions,
                moves: Math.max(12, prep.moveLimit),
              }
            : null,
        auth: prepSource === "local" ? "local" : explorerToken ? "auth" : "no-auth",
      }),
    [
      explorerToken,
      lichessOptions,
      masterOptions,
      prep.color,
      prep.databasePath,
      prep.end_date,
      prep.moveLimit,
      prep.player,
      prep.playerName,
      prep.result,
      prepMode,
      prepSource,
      prep.start_date,
    ],
  );
  const currentSearchId =
    configReady && prepSource === "local" ? getPrepSearchId(queryScope, currentFen) : null;

  useEffect(() => {
    moveCacheRef.current.clear();
  }, [queryScope]);

  useEffect(() => {
    builderReferenceCacheRef.current.clear();
  }, [lichessOptions]);

  useEffect(() => {
    if (
      seededRef.current ||
      prepSource !== "local" ||
      prep.databasePath ||
      localDatabases.length === 0
    ) {
      return;
    }
    const seed = getInitialPrepSeed({
      currentLocalOptions,
      localDatabases,
      referenceDb,
      savedCompareSettings,
    });
    if (!seed) return;

    seededRef.current = true;
    setPrep((current) => ({
      ...current,
      ...seed,
      rootPath: current.rootPath ?? currentPath,
    }));
  }, [
    currentLocalOptions,
    currentPath,
    localDatabases,
    prep.databasePath,
    prepSource,
    referenceDb,
    savedCompareSettings,
    setPrep,
  ]);

  useEffect(() => {
    if (!configReady || prep.rootPath !== null) return;
    setPrep((current) =>
      current.rootPath === null
        ? {
            ...current,
            rootPath: currentPath,
          }
        : current,
    );
  }, [configReady, currentPath, prep.rootPath, setPrep]);

  useEffect(() => {
    if (!currentSearchId) return undefined;

    return () => {
      void cancelDatabaseSearch(currentSearchId);
    };
  }, [currentSearchId]);

  const loadOpeningsForFen = useCallback(
    async (fen: string, moveLimitOverride?: number) => {
      if (prepSource === "local" && !prep.databasePath) return [];
      if (prepSource !== "local" && !explorerToken) return [];

      const moveLimit = moveLimitOverride ?? prep.moveLimit;
      const cacheKey = `${queryScope}|${moveLimit}|${fen}`;
      const cached = moveCacheRef.current.get(cacheKey);
      if (cached) return cached;

      let openings: Opening[];
      if (prepSource === "lch_all") {
        const data = await getLichessGames(
          fen,
          {
            ...lichessOptions,
            player: undefined,
            moves: getPrepBuilderExplorerMoveLimit(moveLimit),
          },
          explorerToken,
        );
        openings = lichessMovesToOpenings(data.moves);
      } else if (prepSource === "lch_master") {
        const data = await getMasterGames(
          fen,
          {
            ...masterOptions,
            moves: getPrepBuilderExplorerMoveLimit(moveLimit),
          },
          explorerToken,
        );
        openings = lichessMovesToOpenings(data.moves);
      } else {
        const requestId = getPrepSearchId(queryScope, fen);
        const [localOpenings] = await searchPosition(
          {
            path: prep.databasePath,
            fen,
            type: "exact",
            player: prepMode === "player" ? prep.player : null,
            playerName: prepMode === "player" ? prep.playerName : "",
            color: prep.color,
            start_date: prep.start_date,
            end_date: prep.end_date,
            result: prep.result,
          },
          requestId,
          {
            includeGames: false,
          },
        );
        openings = localOpenings;
      }

      moveCacheRef.current.set(cacheKey, openings);
      return openings;
    },
    [
      explorerToken,
      lichessOptions,
      masterOptions,
      prep.color,
      prep.databasePath,
      prep.end_date,
      prep.moveLimit,
      prep.player,
      prep.playerName,
      prep.result,
      prep.start_date,
      prepMode,
      prepSource,
      queryScope,
    ],
  );

  const loadLichessAllOpeningsForFen = useCallback(
    async (fen: string, settings: PrepBuilderSettings) => {
      if (!settings.useLichessAll) return [];
      const moveLimit = getPrepBuilderReferenceMoveLimit(settings.opponentMoveLimit);

      const cacheKey = JSON.stringify({
        source: "builder-lichess-all",
        fen,
        moves: moveLimit,
        lichessOptions,
        auth: explorerToken ? "auth" : "public",
      });
      const cached = builderReferenceCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const data = await getLichessGames(
        fen,
        {
          ...lichessOptions,
          player: undefined,
          moves: moveLimit,
        },
        explorerToken,
      );
      const openings = lichessMovesToOpenings(data.moves);
      builderReferenceCacheRef.current.set(cacheKey, openings);
      return openings;
    },
    [explorerToken, lichessOptions],
  );

  const loadPrepBuilderEngineMoves = useCallback(
    async (fen: string, userColor: "white" | "black", settings: PrepBuilderSettings) => {
      if (!settings.useCloudEngine) return [];

      const multipv = Math.max(3, Math.min(8, settings.opponentMoveLimit + 3));
      const [lichessResult, chessDbResult] = await Promise.allSettled([
        queryLichessCloudMoves(fen, multipv),
        queryChessDbMoves(fen),
      ]);
      const lichessMoves =
        lichessResult.status === "fulfilled" && lichessResult.value
          ? lichessResult.value.map<PrepBuilderEngineMove>((move, index) => ({
              san: move.san,
              scoreCpForSide:
                move.scoreCpForWhite === null
                  ? null
                  : userColor === "black"
                    ? -move.scoreCpForWhite
                    : move.scoreCpForWhite,
              rank: index + 1,
              source: "lichess",
            }))
          : [];
      const chessDbMoves =
        chessDbResult.status === "fulfilled" && chessDbResult.value
          ? chessDbResult.value.map<PrepBuilderEngineMove>((move, index) => ({
              san: move.san,
              scoreCpForSide:
                move.scoreCpForWhite === null
                  ? null
                  : userColor === "black"
                    ? -move.scoreCpForWhite
                    : move.scoreCpForWhite,
              rank: move.rank ?? index + 1,
              source: "chessdb",
            }))
          : [];

      return mergePrepBuilderEngineMoves([...lichessMoves, ...chessDbMoves]).slice(0, multipv);
    },
    [],
  );

  const {
    data: currentOpenings,
    isLoading,
    error,
  } = useSWR(configReady ? ["opponent-prep-openings", queryScope, currentFen] : null, () =>
    loadOpeningsForFen(currentFen),
  );

  const currentRows = useMemo(
    () =>
      opponentToMove
        ? getOpponentPrepMoveRows({
            fen: currentFen,
            node: currentNode,
            openings: currentOpenings ?? [],
            minGames: prep.minGames,
            moveLimit: prep.moveLimit,
            completedBranches: prep.completedBranches,
            skippedBranches: prep.skippedBranches,
          })
        : [],
    [
      currentFen,
      currentNode,
      currentOpenings,
      opponentToMove,
      prep.completedBranches,
      prep.minGames,
      prep.moveLimit,
      prep.skippedBranches,
    ],
  );
  const candidateRows = useMemo(
    () =>
      !opponentToMove
        ? getPrepCandidateRows({
            fen: currentFen,
            openings: currentOpenings ?? [],
            minGames: prep.minGames,
            moveLimit: prep.moveLimit,
          })
        : [],
    [currentFen, currentOpenings, opponentToMove, prep.minGames, prep.moveLimit],
  );
  const currentTreeHash = useMemo(() => getTreeStructureHash(currentNode), [currentNode]);
  const branchStatsKey =
    configReady && opponentToMove && currentRows.length > 0
      ? [
          "opponent-prep-branch-stats",
          queryScope,
          currentFen,
          prep.minGames,
          prep.moveLimit,
          currentTreeHash,
          JSON.stringify(prep.completedBranches),
          JSON.stringify(prep.skippedBranches),
          currentRows.map((row) => row.key).join("|"),
        ]
      : null;
  const { data: branchStatsByKey, isLoading: branchStatsLoading } = useSWR(
    branchStatsKey,
    async () => {
      const entries = await Promise.all(
        currentRows.map(async (row) => {
          const stats = await getOpponentPrepBranchStats({
            parentNode: currentNode,
            row,
            opponentColor: prep.color,
            loadOpenings: loadOpeningsForFen,
            minGames: prep.minGames,
            moveLimit: prep.moveLimit,
            completedBranches: prep.completedBranches,
            skippedBranches: prep.skippedBranches,
          });
          return [row.key, stats] as const;
        }),
      );

      return Object.fromEntries(entries);
    },
  );
  const activeBranch = useMemo(
    () =>
      isInsidePrepTree ? findLastOpponentBranch(root, currentPath, prep.color, rootPath) : null,
    [currentPath, isInsidePrepTree, prep.color, root, rootPath],
  );
  const lineSans = useMemo(
    () => (isInsidePrepTree ? getLineSans(root, currentPath, rootPath) : []),
    [currentPath, isInsidePrepTree, root, rootPath],
  );
  const rootSans = useMemo(() => getLineSans(root, rootPath), [root, rootPath]);
  const preparedCount = currentRows.filter((row) => row.status === "prepared").length;
  const startedCount = currentRows.filter((row) => row.status === "started").length;
  const skippedCount = currentRows.filter((row) => row.status === "skipped").length;
  const controlSize = compact ? "xs" : "sm";
  const databaseLabel = selectedDatabase?.title || selectedDatabase?.filename || prep.databaseLabel;
  const canOverwriteCurrent =
    currentTab?.gameOrigin.kind === "file" ||
    currentTab?.gameOrigin.kind === "temp_file" ||
    currentTab?.gameOrigin.kind === "database";

  const updateSettings = useCallback(
    (
      patch: Partial<
        Pick<
          OpponentPrepState,
          | "mode"
          | "source"
          | "databasePath"
          | "databaseLabel"
          | "player"
          | "playerName"
          | "color"
          | "minGames"
          | "moveLimit"
        >
      >,
      resetProgress = true,
    ) => {
      setPrep((current) => ({
        ...current,
        ...patch,
        rootPath: resetProgress ? currentPath : current.rootPath,
        completedBranches: resetProgress ? {} : current.completedBranches,
        skippedBranches: resetProgress ? {} : current.skippedBranches,
      }));
    },
    [currentPath, setPrep],
  );

  const updateBuilderSettings = useCallback(
    (patch: Partial<PrepBuilderSettings>) => {
      setPrep((current) => ({
        ...current,
        builder: normalizePrepBuilderSettings(getPrepBuilderSettingsPatch(current.builder, patch)),
      }));
    },
    [setPrep],
  );

  const changePrepMode = useCallback(
    (mode: "player" | "general") => {
      if (mode === "general") {
        updateSettings(
          {
            mode,
            color: "black",
            player: null,
            playerName: "",
          },
          true,
        );
        return;
      }

      if (prepSource === "local") {
        updateSettings({ mode }, true);
        return;
      }

      const database = localDatabases[0] ?? null;
      updateSettings(
        {
          mode,
          source: "local",
          databasePath: database?.file ?? null,
          databaseLabel: database ? database.title || database.filename : null,
          player: null,
          playerName: "",
        },
        true,
      );
    },
    [localDatabases, prepSource, updateSettings],
  );

  const changePrepSource = useCallback(
    (value: string | null) => {
      if (!value) return;

      if (value === LICHESS_ALL_SOURCE) {
        updateSettings(
          {
            mode: "general",
            source: "lch_all",
            databasePath: null,
            databaseLabel: "Lichess All",
            color: prepMode === "general" ? prep.color : "black",
            player: null,
            playerName: "",
          },
          true,
        );
        return;
      }

      if (value === LICHESS_MASTER_SOURCE) {
        updateSettings(
          {
            mode: "general",
            source: "lch_master",
            databasePath: null,
            databaseLabel: "Lichess Masters",
            color: prepMode === "general" ? prep.color : "black",
            player: null,
            playerName: "",
          },
          true,
        );
        return;
      }

      const database = localDatabases.find((item) => item.file === value);
      updateSettings(
        {
          source: "local",
          databasePath: value,
          databaseLabel: database ? database.title || database.filename : null,
          player: null,
          playerName: "",
        },
        true,
      );
    },
    [localDatabases, prep.color, prepMode, updateSettings],
  );

  const changeGeneralUserColor = useCallback(
    (color: "white" | "black") => {
      updateSettings({ color: oppositePrepColor(color) }, true);
    },
    [updateSettings],
  );

  const clearMovePreview = useCallback(() => {
    setBoardPreviewShapes(null);
  }, [setBoardPreviewShapes]);

  const previewMove = useCallback(
    (moveSan: string) => {
      const [pos] = positionFromFen(currentFen);
      if (!pos) {
        clearMovePreview();
        return;
      }

      const move = parseSan(pos, moveSan);
      if (!move || !isNormal(move)) {
        clearMovePreview();
        return;
      }

      setBoardPreviewShapes({
        fen: currentFen,
        shapes: [
          {
            orig: makeSquare(move.from),
            dest: makeSquare(move.to),
            brush: "preview",
            modifiers: {
              lineWidth: 10,
            },
          },
        ],
      });
    },
    [clearMovePreview, currentFen, setBoardPreviewShapes],
  );

  useEffect(() => clearMovePreview, [clearMovePreview]);

  const playMove = useCallback(
    (moveSan: string) => {
      clearMovePreview();
      store.getState().makeMove({ payload: moveSan });
    },
    [clearMovePreview, store],
  );

  const playCommonMoveFromStart = useCallback(async () => {
    if (!configReady || commonMoving) return;

    setCommonMoving(true);
    clearMovePreview();
    try {
      const state = store.getState();
      const safeRootPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      const start = findOpponentPrepStart(state.root, safeRootPath, prep.color);

      if (!start) {
        notifications.show({
          title: "Choose your move first",
          message: "Play into the prep line before asking for the opponent's common move.",
          color: "yellow",
        });
        return;
      }

      const branchNode = state.getNode(start.branchPath);
      if (!branchNode) return;

      const openings = await loadOpeningsForFen(branchNode.fen);
      const rows = getOpponentPrepMoveRows({
        fen: branchNode.fen,
        node: branchNode,
        openings,
        minGames: prep.minGames,
        moveLimit: prep.moveLimit,
        completedBranches: prep.completedBranches,
        skippedBranches: prep.skippedBranches,
      });
      const nextRow = rows.find((row) => row.status === "new" || row.status === "started");

      store.getState().goToMove(start.branchPath);
      if (!nextRow) {
        notifications.show({
          title: "Shown moves covered",
          message: "No unprepared move is left in Show top. Increase Show top to include more.",
          color: "green",
        });
        return;
      }

      store.getState().makeMove({ payload: nextRow.move });
    } catch (error) {
      notifications.show({
        title: "Could not play the common move",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setCommonMoving(false);
    }
  }, [
    clearMovePreview,
    commonMoving,
    configReady,
    loadOpeningsForFen,
    prep.color,
    prep.completedBranches,
    prep.minGames,
    prep.moveLimit,
    prep.rootPath,
    prep.skippedBranches,
    store,
  ]);

  const markMoveDone = useCallback(
    (row: Pick<OpponentPrepMoveRow, "key">) => {
      setPrep((current) => ({
        ...current,
        completedBranches: {
          ...current.completedBranches,
          [row.key]: Date.now(),
        },
        skippedBranches: omitKey(current.skippedBranches, row.key),
      }));
    },
    [setPrep],
  );

  const skipMove = useCallback(
    (row: Pick<OpponentPrepMoveRow, "key">) => {
      setPrep((current) => ({
        ...current,
        completedBranches: omitKey(current.completedBranches, row.key),
        skippedBranches: {
          ...current.skippedBranches,
          [row.key]: Date.now(),
        },
      }));
    },
    [setPrep],
  );

  const setRootHere = useCallback(() => {
    setPrep((current) => ({
      ...current,
      rootPath: currentPath,
      completedBranches: {},
      skippedBranches: {},
    }));
  }, [currentPath, setPrep]);

  const resetLine = useCallback(() => {
    store.getState().goToMove(rootPath);
  }, [rootPath, store]);

  const goToActiveChoice = useCallback(() => {
    if (!activeBranch) return;
    store.getState().goToMove(activeBranch.branchPath);
  }, [activeBranch, store]);

  const advanceToNextBranch = useCallback(async () => {
    if (!configReady || advancing) return;

    setAdvancing(true);
    clearMovePreview();
    try {
      const state = store.getState();
      const safeRootPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      const currentInsidePrep = isPrefix(safeRootPath, state.position);
      const start = findOpponentPrepStart(state.root, safeRootPath, prep.color);
      const active = start?.branch
        ? start.branch
        : currentInsidePrep && start
          ? findFirstOpponentBranch(state.root, state.position, prep.color, start.branchPath)
          : null;
      const branchPath = start?.branchPath;
      const completedBranches = {
        ...prep.completedBranches,
        ...(active ? { [active.key]: Date.now() } : {}),
      };

      if (active) {
        setPrep((current) => ({
          ...current,
          completedBranches: {
            ...current.completedBranches,
            [active.key]: Date.now(),
          },
          skippedBranches: omitKey(current.skippedBranches, active.key),
        }));
      }

      if (!branchPath) {
        notifications.show({
          title: "Choose your reply first",
          message: "Play into the prep line before cycling their replies.",
          color: "yellow",
        });
        return;
      }

      const branchNode = state.getNode(branchPath);
      if (!branchNode) return;

      const openings = await loadOpeningsForFen(branchNode.fen);
      const rows = getOpponentPrepMoveRows({
        fen: branchNode.fen,
        node: branchNode,
        openings,
        minGames: prep.minGames,
        moveLimit: prep.moveLimit,
        completedBranches,
        skippedBranches: prep.skippedBranches,
      });
      const nextRow = rows.find((row) => row.status === "new" || row.status === "started");

      if (nextRow) {
        store.getState().goToMove(branchPath);
        store.getState().makeMove({ payload: nextRow.move });
        notifications.show({
          title: "Next prep branch",
          message: `${nextRow.move} is next in ${databaseLabel || "the selected database"}.`,
          color: "blue",
        });
        return;
      }

      store.getState().goToMove(branchPath);
      notifications.show({
        title: "Prep branches covered",
        message: "No unprepared move is left in Show top. Increase Show top to include more.",
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Could not move to the next branch",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setAdvancing(false);
    }
  }, [
    advancing,
    clearMovePreview,
    configReady,
    databaseLabel,
    loadOpeningsForFen,
    prep.color,
    prep.completedBranches,
    prep.minGames,
    prep.moveLimit,
    prep.rootPath,
    prep.skippedBranches,
    setPrep,
    store,
  ]);

  const runPrepBuilder = useCallback(async () => {
    if (!configReady || builderRunning) return;

    const settings = normalizePrepBuilderSettings(prep.builder);
    const userSide = oppositePrepColor(prep.color);
    const safetyPositionLimit = getPrepBuilderSafetyPositionLimit(settings.size);
    builderCancelRef.current = false;
    setBuilderRunning(true);
    setBuilderNeedsSave(false);
    clearMovePreview();
    setBuilderStatus({
      phase: "Starting",
      addedMoves: 0,
      visitedPositions: 0,
      stoppedLines: 0,
    });

    let addedMoves = 0;
    let visitedPositions = 0;
    let stoppedLines = 0;
    let touchedTree = false;
    let currentPhase = "Starting";
    let lastPublishedAt = 0;
    let lastYieldWork = 0;

    const updateStatus = (phase: string, force = false) => {
      currentPhase = phase;
      const now = Date.now();
      if (!force && now - lastPublishedAt < 120) return;
      lastPublishedAt = now;
      setBuilderStatus({
        phase,
        addedMoves,
        visitedPositions,
        stoppedLines,
      });
    };

    const yieldToBuilderUi = async (force = false) => {
      const work = addedMoves + visitedPositions + stoppedLines;
      if (!force && work - lastYieldWork < 6) return;
      lastYieldWork = work;
      updateStatus(currentPhase, true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    };

    const addMoveWithComment = (
      path: number[],
      moveSan: string,
      comment: string,
    ) => {
      const state = store.getState();
      if (!pathExists(state.root, path)) return null;

      const parent = state.getNode(path);
      if (!parent) return null;
      const existingIndex = parent.children.findIndex((child) => child.san === moveSan);
      state.goToMove(path);
      state.makeMove({ payload: moveSan, changeHeaders: false });

      const nextPath = store.getState().position;
      if (!isPrefix(path, nextPath) || nextPath.length !== path.length + 1) {
        return null;
      }

      const node = store.getState().getNode(nextPath);
      if (!node) return null;
      const nextComment = mergePrepBuilderComment(node.comment, comment);
      store.getState().setCommentAtPath(nextPath, nextComment);

      return {
        path: nextPath,
        created: existingIndex === -1,
      };
    };

    const addUserResponseAtPath = async (
      task: PrepBuilderQueueItem,
    ): Promise<PrepBuilderQueueItem | null> => {
      if (builderCancelRef.current) return null;

      const currentState = store.getState();
      if (!pathExists(currentState.root, task.path)) return null;

      const node = currentState.getNode(task.path);
      if (!node) return null;

      const stopReason = getPrepBuilderStopReason({
        branchShare: task.branchShare,
        depthShare: task.depthShare,
        ply: task.ply,
        settings,
      });
      if (stopReason) {
        stoppedLines += 1;
        updateStatus(stopReason);
        return null;
      }

      const existingResponseIndex = getPrepBuilderUserResponseChildIndex(node);
      if (existingResponseIndex !== null) {
        return {
          path: [...task.path, existingResponseIndex],
          branchShare: task.branchShare,
          depthShare: task.depthShare,
          branchValue: task.branchValue,
          ply: task.ply + 1,
        };
      }

      updateStatus("Choosing your move");
      const [opponentOpenings, referenceOpenings, engineMoves] = await Promise.all([
        loadOpeningsForFen(node.fen, settings.opponentMoveLimit).catch(() => []),
        loadLichessAllOpeningsForFen(node.fen, settings).catch(() => []),
        loadPrepBuilderEngineMoves(node.fen, userSide, settings).catch(() => []),
      ]);
      if (builderCancelRef.current) return null;

      const availableGames = opponentOpenings.reduce(
        (sum, opening) => sum + getOpeningTotal(opening),
        0,
      );
      const hasDatabaseCandidate = hasPrepBuilderDatabaseCandidates(
        opponentOpenings,
        settings.minOpponentGames,
      );
      const availabilityStop = getPrepBuilderStopReason({
        branchShare: task.branchShare,
        depthShare: task.depthShare,
        ply: task.ply,
        availableGames,
        settings,
      });

      if (availabilityStop && referenceOpenings.length === 0 && engineMoves.length === 0) {
        stoppedLines += 1;
        updateStatus(availabilityStop);
        return null;
      }

      if (!hasDatabaseCandidate) {
        stoppedLines += 1;
        updateStatus("No database result");
        return null;
      }

      const choice = choosePrepBuilderMove({
        opponentOpenings,
        referenceOpenings,
        engineMoves,
        userColor: userSide,
        settings,
      });

      if (!choice) {
        stoppedLines += 1;
        updateStatus("No supported database move");
        return null;
      }

      const child = addMoveWithComment(
        task.path,
        choice.move,
        formatPrepBuilderChoiceComment(choice),
      );
      if (!child) {
        stoppedLines += 1;
        updateStatus("Could not add chosen move");
        return null;
      }
      touchedTree = true;
      if (child.created) addedMoves += 1;
      await yieldToBuilderUi();

      return {
        path: child.path,
        branchShare: task.branchShare,
        depthShare: task.depthShare,
        branchValue: task.branchValue,
        ply: task.ply + 1,
      };
    };

    try {
      const state = store.getState();
      const safeRootPath = pathExists(state.root, prep.rootPath ?? []) ? (prep.rootPath ?? []) : [];
      const queue: PrepBuilderQueueItem[] = [
        {
          path: safeRootPath,
          branchShare: 1,
          depthShare: 1,
          ply: 0,
        },
      ];

      while (
        queue.length > 0 &&
        visitedPositions < safetyPositionLimit &&
        !builderCancelRef.current
      ) {
        const task = queue.shift()!;
        if (builderCancelRef.current) break;
        const currentState = store.getState();
        if (!pathExists(currentState.root, task.path)) continue;

        const node = currentState.getNode(task.path);
        if (!node) continue;
        const stopReason = getPrepBuilderStopReason({
          branchShare: task.branchShare,
          depthShare: task.depthShare,
          ply: task.ply,
          settings,
        });
        if (stopReason) {
          stoppedLines += 1;
          updateStatus(stopReason);
          continue;
        }

        const turn = getFenTurn(node.fen);

        if (turn === prep.color) {
          visitedPositions += 1;
          updateStatus(prepMode === "general" ? "Adding common replies" : "Adding their replies");
          const replyPolicy = getPrepBuilderReplyPolicy({
            branchShare: task.depthShare,
            settings,
          });
          const openings = await loadOpeningsForFen(
            node.fen,
            getPrepBuilderBranchSearchMoveLimit(settings),
          );
          if (builderCancelRef.current) break;
          const rows = getOpponentPrepMoveRows({
            fen: node.fen,
            node,
            openings,
            minGames: settings.minOpponentGames,
            moveLimit: replyPolicy.moveLimit,
            completedBranches: prep.completedBranches,
            skippedBranches: prep.skippedBranches,
          }).filter(
            (row) =>
              row.status !== "skipped" &&
              row.total >= settings.minOpponentGames &&
              row.share * 100 >= replyPolicy.minMoveShare,
          );

          if (rows.length === 0) {
            stoppedLines += 1;
            updateStatus("No common reply above threshold");
            continue;
          }

          const nextTasks: PrepBuilderQueueItem[] = [];
          for (const row of rows.slice(0, replyPolicy.moveLimit)) {
            if (builderCancelRef.current) break;

            const nextBranchShare = task.branchShare * row.share;
            const nextDepthShare = Math.min(task.depthShare, row.share);
            const nextBranchValue = getPrepBuilderBranchValue({
              opening: row,
              userColor: userSide,
              settings,
            });
            const nextPly = task.ply + 1;
            const branchStopReason = getPrepBuilderStopReason({
              branchShare: nextBranchShare,
              depthShare: nextDepthShare,
              ply: nextPly,
              settings,
            });
            if (branchStopReason) {
              stoppedLines += 1;
              updateStatus(branchStopReason);
              continue;
            }

            const child = addMoveWithComment(
              task.path,
              row.move,
              formatPrepBuilderOpponentComment({
                row,
                branchShare: nextBranchShare,
                general: prepMode === "general",
              }),
            );
            if (!child) continue;

            const responseChild = await addUserResponseAtPath({
              path: child.path,
              branchShare: nextBranchShare,
              depthShare: nextDepthShare,
              branchValue: nextBranchValue,
              ply: nextPly,
            });
            if (!responseChild) {
              if (child.created) {
                store.getState().deleteMove(child.path);
              }
              continue;
            }

            touchedTree = true;
            if (child.created) addedMoves += 1;
            nextTasks.push(responseChild);
            await yieldToBuilderUi();
          }
          queue.unshift(...nextTasks);
        } else {
          const responseChild = await addUserResponseAtPath(task);
          if (responseChild) queue.unshift(responseChild);
        }
        await yieldToBuilderUi();
      }

      store.getState().goToMove(safeRootPath);
      updateStatus(
        builderCancelRef.current
          ? "Stopped"
          : queue.length > 0 && visitedPositions >= safetyPositionLimit
            ? "Safety stop"
            : "Done",
        true,
      );
      setBuilderNeedsSave(touchedTree);
      notifications.show({
        title: builderCancelRef.current ? "Prep builder stopped" : "Prep builder done",
        message: `${addedMoves} move${addedMoves === 1 ? "" : "s"} added.`,
        color: builderCancelRef.current ? "yellow" : "green",
      });
    } catch (error) {
      notifications.show({
        title: "Prep builder failed",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setBuilderRunning(false);
    }
  }, [
    builderRunning,
    clearMovePreview,
    configReady,
    loadLichessAllOpeningsForFen,
    loadOpeningsForFen,
    loadPrepBuilderEngineMoves,
    prep.builder,
    prep.color,
    prep.completedBranches,
    prep.rootPath,
    prep.skippedBranches,
    prepMode,
    store,
  ]);

  const stopPrepBuilder = useCallback(() => {
    builderCancelRef.current = true;
    setBuilderStatus((current) =>
      current
        ? {
            ...current,
            phase: "Stopping",
          }
        : current,
    );
  }, []);

  const saveBuilderResult = useCallback(
    async (mode: "new" | "overwrite") => {
      if (savingBuilderResult) return;

      setSavingBuilderResult(mode);
      try {
        const saved = await saveToFile({
          dir: documentDir,
          tab: currentTab,
          setCurrentTab,
          store,
          forceSaveAs: mode === "new",
        });
        if (!saved) return;

        setBuilderNeedsSave(false);
        notifications.show({
          title: mode === "new" ? "Prep saved to new file" : "Prep saved",
          message:
            mode === "new"
              ? "The generated prep has been saved as a separate PGN."
              : "The generated prep has been written to the current file.",
          color: "green",
        });
      } catch (error) {
        notifications.show({
          title: "Could not save prep",
          message: error instanceof Error ? error.message : String(error),
          color: "red",
        });
      } finally {
        setSavingBuilderResult(null);
      }
    },
    [currentTab, documentDir, savingBuilderResult, setCurrentTab, store],
  );

  return (
    <Stack h="100%" gap={dense ? 4 : "xs"} p={dense ? 4 : "xs"} style={{ overflow: "hidden" }}>
      <Group justify="space-between" align="center" gap="xs" wrap="wrap" style={{ flexShrink: 0 }}>
        <Group gap="xs" wrap="wrap">
          <Text fw={700} fz={compact ? "sm" : "md"}>
            {prepMode === "general" ? "Opening prep" : "Opponent prep"}
          </Text>
          {databaseLabel ? (
            <Badge variant="light" size={compact ? "sm" : "md"}>
              {databaseLabel}
            </Badge>
          ) : null}
          {prepMode === "general" ? (
            <Badge color="teal" variant="light" size={compact ? "sm" : "md"}>
              You as {userColor}
            </Badge>
          ) : prep.playerName.trim() ? (
            <Badge color="orange" variant="light" size={compact ? "sm" : "md"}>
              {prep.playerName.trim()} as {prep.color}
            </Badge>
          ) : null}
        </Group>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Use the current board position as the start for prep and the builder">
            <Button
              variant="default"
              size={controlSize}
              leftSection={<IconTarget size="0.95rem" />}
              onClick={setRootHere}
            >
              Start here
            </Button>
          </Tooltip>
          <Tooltip label="Go back to the starting position">
            <ActionIcon variant="default" size={compact ? "sm" : "lg"} onClick={resetLine}>
              <IconArrowBackUp size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Clear manual done and skipped marks">
            <ActionIcon
              variant="default"
              size={compact ? "sm" : "lg"}
              onClick={() =>
                setPrep((current) => ({
                  ...current,
                  completedBranches: {},
                  skippedBranches: {},
                }))
              }
            >
              <IconRefresh size="1rem" />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Group gap={dense ? 4 : "xs"} wrap="wrap" style={{ flexShrink: 0 }}>
        <Tooltip label="Choose whether to target one player or a general opening source">
          <SegmentedControl
            aria-label="Prep target"
            data={[
              { value: "player", label: "Player" },
              { value: "general", label: "General" },
            ]}
            value={prepMode}
            onChange={(value) => changePrepMode(value as "player" | "general")}
            size={controlSize}
          />
        </Tooltip>
        <Select
          data={sourceOptions}
          value={sourceValue}
          onChange={changePrepSource}
          placeholder="Prep source"
          size={controlSize}
          w={dense ? 180 : 230}
          searchable
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
        {prepMode === "player" ? (
          <DatabasePerspectiveControls
            databasePath={prepSource === "local" ? prep.databasePath : null}
            player={prep.player}
            playerName={prep.playerName}
            color={prep.color}
            onPlayerChange={(player) => updateSettings({ player }, false)}
            onPlayerNameChange={(playerName) => updateSettings({ playerName }, false)}
            onColorChange={(color) => updateSettings({ color }, true)}
            size={controlSize}
            playerWidth={dense ? 130 : 170}
            colorWidth={dense ? 112 : 126}
          />
        ) : (
          <Tooltip label="The side you are preparing to play">
            <SegmentedControl
              aria-label="Your prep side"
              data={[
                { value: "white", label: "White" },
                { value: "black", label: "Black" },
              ]}
              value={userColor}
              onChange={(value) => changeGeneralUserColor(value as "white" | "black")}
              size={controlSize}
              w={dense ? 112 : 126}
            />
          </Tooltip>
        )}
        <Tooltip
          label={
            prepMode === "general"
              ? "Only show database moves that appear at least this many times"
              : "Only show opponent moves they have played at least this many times"
          }
        >
          <NumberInput
            label="Min games"
            value={prep.minGames}
            onChange={(value) =>
              updateSettings(
                {
                  minGames: Math.max(1, Number(value) || DEFAULT_PREP_MIN_GAMES),
                },
                false,
              )
            }
            min={1}
            max={999}
            step={1}
            size={controlSize}
            w={dense ? 92 : 108}
            aria-label="Minimum games"
          />
        </Tooltip>
        <Tooltip
          label={
            prepMode === "general"
              ? "How many common database moves to show at each position"
              : "How many of their most common moves to show at each position"
          }
        >
          <NumberInput
            label="Show top"
            value={prep.moveLimit}
            onChange={(value) =>
              updateSettings(
                {
                  moveLimit: Math.max(1, Number(value) || DEFAULT_PREP_MOVE_LIMIT),
                },
                false,
              )
            }
            min={1}
            max={20}
            step={1}
            size={controlSize}
            w={dense ? 92 : 108}
            aria-label="Top opponent moves to show"
          />
        </Tooltip>
      </Group>

      <Box style={{ flexShrink: 0 }}>
        <Group justify="space-between" gap="xs" wrap="wrap">
          <Group gap={4} wrap="wrap">
            <Tooltip label="Automatically add repertoire lines from the current prep start">
              <Button
                variant="filled"
                size={controlSize}
                leftSection={<IconSparkles size="0.95rem" />}
                disabled={!configReady}
                loading={builderRunning}
                onClick={() => void runPrepBuilder()}
              >
                Build prep
              </Button>
            </Tooltip>
            {builderRunning ? (
              <Tooltip label="Stop after the current lookup finishes">
                <Button
                  color="red"
                  variant="default"
                  size={controlSize}
                  leftSection={<IconX size="0.95rem" />}
                  onClick={stopPrepBuilder}
                >
                  Stop
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip label="Tune how the prep builder balances engine moves, WDL results, breadth, and depth">
              <Button
                variant="default"
                size={controlSize}
                leftSection={<IconSettings size="0.95rem" />}
                onClick={() => setBuilderOpen((open) => !open)}
              >
                Builder settings
              </Button>
            </Tooltip>
          </Group>
          {builderStatus ? (
            <Text size="xs" c={builderRunning ? "blue" : "dimmed"}>
              {builderStatus.phase} - {builderStatus.addedMoves} added,{" "}
              {builderStatus.visitedPositions} checked
            </Text>
          ) : null}
        </Group>
        <Collapse in={builderOpen}>
          <Stack gap={dense ? 4 : "xs"} pt="xs">
            <Group gap={dense ? 4 : "xs"} wrap="wrap">
              <SegmentedControl
                aria-label="Prep builder mode"
                data={[
                  { value: "smart", label: "Smart" },
                  { value: "engine", label: "Engine" },
                  { value: "practical", label: "Practical" },
                ]}
                value={builderSettings.mode}
                onChange={(value) =>
                  updateBuilderSettings({ mode: value as PrepBuilderSettings["mode"] })
                }
                size={controlSize}
              />
              <SegmentedControl
                aria-label="Prep builder depth"
                data={[
                  { value: "quick", label: "Short" },
                  { value: "balanced", label: "Normal" },
                  { value: "deep", label: "Deep" },
                ]}
                value={builderSettings.size}
                onChange={(value) =>
                  updateBuilderSettings({ size: value as PrepBuilderSettings["size"] })
                }
                size={controlSize}
              />
              <Tooltip label="Opponent moves below this play rate are ignored by the builder">
                <NumberInput
                  label="Min play rate"
                  suffix="%"
                  value={builderSettings.minOpponentMoveShare}
                  onChange={(value) =>
                    updateBuilderSettings({
                      minOpponentMoveShare: Math.max(0, Number(value) || 0),
                    })
                  }
                  min={0}
                  max={80}
                  step={1}
                  size={controlSize}
                  w={dense ? 104 : 128}
                  aria-label="Minimum opponent play rate"
                />
              </Tooltip>
              <Badge variant="light">Lichess All reference</Badge>
              <Badge variant="light">Cloud engine</Badge>
            </Group>
          </Stack>
          <Divider my={dense ? 4 : "xs"} />
        </Collapse>
        {builderNeedsSave ? (
          <Group gap={4} mt={dense ? 4 : "xs"} wrap="wrap">
            <Text size="xs" c="dimmed">
              Builder output is ready to save.
            </Text>
            <Button
              variant="default"
              size={controlSize}
              loading={savingBuilderResult === "new"}
              onClick={() => void saveBuilderResult("new")}
            >
              Save new file
            </Button>
            <Button
              variant="default"
              size={controlSize}
              disabled={!canOverwriteCurrent}
              loading={savingBuilderResult === "overwrite"}
              onClick={() => void saveBuilderResult("overwrite")}
            >
              Overwrite current
            </Button>
          </Group>
        ) : null}
      </Box>

      <Group justify="space-between" gap="xs" wrap="wrap" style={{ flexShrink: 0 }}>
        <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
          <Text size="xs" c="dimmed" truncate>
            Start: {rootSans.length > 0 ? rootSans.join(" ") : "game start"}
          </Text>
          <Text size="xs" c={opponentToMove ? undefined : "dimmed"} truncate>
            {opponentToMove
              ? prepMode === "general"
                ? `${prep.color === "white" ? "White" : "Black"} to move`
                : `${prep.playerName.trim() || "Opponent"} to move`
              : `Play your ${userColor} ${prepMode === "general" ? "move" : "response"} on the board`}
            {lineSans.length > 0 ? ` - ${lineSans.slice(-10).join(" ")}` : ""}
          </Text>
        </Stack>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Play the first unprepared common move from the prep start">
            <Button
              variant="filled"
              size={controlSize}
              leftSection={<IconPlayerPlay size="0.95rem" />}
              disabled={!configReady}
              loading={commonMoving}
              onClick={() => void playCommonMoveFromStart()}
            >
              Common move
            </Button>
          </Tooltip>
          <Tooltip label="Mark this line done and play the next common move from the starting position">
            <Button
              variant="default"
              size={controlSize}
              leftSection={<IconArrowRight size="0.95rem" />}
              disabled={!configReady}
              loading={advancing}
              onClick={() => void advanceToNextBranch()}
            >
              Done + next
            </Button>
          </Tooltip>
          {activeBranch ? (
            <Tooltip label="Return to the last opponent choice in this line">
              <ActionIcon variant="default" size={compact ? "sm" : "lg"} onClick={goToActiveChoice}>
                <IconArrowBackUp size="1rem" />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </Group>
      </Group>

      {!sourceReady ? (
        <Alert color="yellow" variant="light">
          {missingExplorerToken
            ? "Link a Lichess account to use Lichess All or Lichess Masters in prep."
            : "Choose a prep source before starting."}
        </Alert>
      ) : !targetReady ? (
        <Alert color="yellow" variant="light">
          Choose the opponent player and the colour they play in the games you want to prepare
          against.
        </Alert>
      ) : !isInsidePrepTree ? (
        <Alert color="blue" variant="light">
          You are away from the starting position for this prep. Go back to start, or start from the
          current board position.
        </Alert>
      ) : null}

      {configReady && opponentToMove && currentRows.length > 0 ? (
        <Group gap="xs" wrap="wrap" style={{ flexShrink: 0 }}>
          <Badge variant="light">{preparedCount} prepared</Badge>
          {startedCount > 0 ? <Badge variant="light">{startedCount} started</Badge> : null}
          {skippedCount > 0 ? (
            <Badge color="gray" variant="light">
              {skippedCount} skipped
            </Badge>
          ) : null}
          <Text size="xs" c="dimmed">
            {formatNumber(currentRows.reduce((sum, row) => sum + row.total, 0))} games in shown
            moves
          </Text>
        </Group>
      ) : null}

      <Box flex={1} style={{ minHeight: 0, overflow: "auto" }}>
        {error ? (
          <Alert color="red">Could not search the prep source from this position.</Alert>
        ) : !configReady ? null : opponentToMove ? (
          <OpponentPrepMoveTable
            rows={currentRows}
            loading={isLoading}
            dense={dense}
            general={prepMode === "general"}
            onPlay={playMove}
            onDone={markMoveDone}
            onSkip={skipMove}
            onPreview={previewMove}
            onClearPreview={clearMovePreview}
            branchStatsByKey={branchStatsByKey}
            branchStatsLoading={branchStatsLoading}
          />
        ) : (
          <PrepCandidateMoveTable
            rows={candidateRows}
            loading={isLoading}
            dense={dense}
            general={prepMode === "general"}
            userColor={userColor}
            onPlay={playMove}
            onPreview={previewMove}
            onClearPreview={clearMovePreview}
          />
        )}
      </Box>
    </Stack>
  );
}

function OpponentPrepMoveTable({
  rows,
  loading,
  dense,
  general,
  onPlay,
  onDone,
  onSkip,
  onPreview,
  onClearPreview,
  branchStatsByKey,
  branchStatsLoading,
}: {
  rows: OpponentPrepMoveRow[];
  loading: boolean;
  dense: boolean;
  general: boolean;
  onPlay: (move: string) => void;
  onDone: (row: OpponentPrepMoveRow) => void;
  onSkip: (row: OpponentPrepMoveRow) => void;
  onPreview: (move: string) => void;
  onClearPreview: () => void;
  branchStatsByKey?: Record<string, OpponentPrepBranchStats>;
  branchStatsLoading: boolean;
}) {
  const textSize = dense ? "xs" : "sm";

  if (loading) {
    return (
      <Stack gap="xs" py="md" align="center">
        <Progress value={100} animated w="min(18rem, 100%)" />
        <Text size="xs" c="dimmed">
          {general ? "Checking database moves" : "Checking opponent moves"}
        </Text>
      </Stack>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert color="gray" variant="light">
        {general
          ? "No common database moves met the current game threshold from this position."
          : "No common opponent moves met the current game threshold from this position."}
      </Alert>
    );
  }

  return (
    <Table
      withTableBorder
      stickyHeader
      highlightOnHover
      horizontalSpacing={dense ? 4 : "xs"}
      verticalSpacing={dense ? 3 : "xs"}
    >
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={{ width: dense ? 64 : 90 }}>Move</Table.Th>
          <Table.Th style={{ width: dense ? 78 : 110 }}>Games</Table.Th>
          <Table.Th>Results</Table.Th>
          <Table.Th style={{ width: dense ? 110 : 150 }}>Prep</Table.Th>
          <Table.Th style={{ width: dense ? 76 : 98 }}>State</Table.Th>
          <Table.Th style={{ width: dense ? 96 : 120 }} />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr
            key={row.key}
            style={{ cursor: "pointer" }}
            onClick={() => onPlay(row.move)}
            onMouseEnter={() => onPreview(row.move)}
            onMouseLeave={onClearPreview}
          >
            <Table.Td>
              <Text size={textSize} fw={700}>
                {row.move}
              </Text>
              {row.lastPlayed ? (
                <Text size="xs" c="dimmed">
                  {row.lastPlayed}
                </Text>
              ) : null}
            </Table.Td>
            <Table.Td>
              <Text size={textSize}>{formatNumber(row.total)}</Text>
              <Text size="xs" c="dimmed">
                {(row.share * 100).toFixed(0)}%
              </Text>
            </Table.Td>
            <Table.Td>
              <PrepResultBar row={row} />
            </Table.Td>
            <Table.Td>
              <BranchStatsCell
                stats={branchStatsByKey?.[row.key]}
                loading={branchStatsLoading}
                dense={dense}
              />
            </Table.Td>
            <Table.Td>
              <Badge color={statusColor(row.status)} variant="light" size="sm">
                {statusLabel(row.status)}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Group gap={2} wrap="nowrap" justify="flex-end">
                <Tooltip label="Play this move">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPlay(row.move);
                    }}
                  >
                    <IconPlayerPlay size="0.95rem" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Mark this branch done">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDone(row);
                    }}
                  >
                    <IconCheck size="0.95rem" />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Skip this branch">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSkip(row);
                    }}
                  >
                    <IconX size="0.95rem" />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function PrepCandidateMoveTable({
  rows,
  loading,
  dense,
  general,
  userColor,
  onPlay,
  onPreview,
  onClearPreview,
}: {
  rows: PrepCandidateMoveRow[];
  loading: boolean;
  dense: boolean;
  general: boolean;
  userColor: "white" | "black";
  onPlay: (move: string) => void;
  onPreview: (move: string) => void;
  onClearPreview: () => void;
}) {
  const textSize = dense ? "xs" : "sm";
  const colorLabel = userColor === "white" ? "White" : "Black";

  if (loading) {
    return (
      <Stack gap="xs" py="md" align="center">
        <Progress value={100} animated w="min(18rem, 100%)" />
        <Text size="xs" c="dimmed">
          Checking candidate moves
        </Text>
      </Stack>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert color="gray" variant="light">
        No candidate moves met the current game threshold from this position.
      </Alert>
    );
  }

  return (
    <Stack gap={dense ? 4 : "xs"}>
      <Group gap="xs" wrap="wrap" style={{ flexShrink: 0 }}>
        <Badge color="blue" variant="light">
          {colorLabel} candidates
        </Badge>
        <Text size="xs" c="dimmed">
          {formatNumber(rows.reduce((sum, row) => sum + row.total, 0))} games in shown moves
        </Text>
      </Group>
      <Table
        withTableBorder
        stickyHeader
        highlightOnHover
        horizontalSpacing={dense ? 4 : "xs"}
        verticalSpacing={dense ? 3 : "xs"}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: dense ? 64 : 90 }}>Move</Table.Th>
            <Table.Th style={{ width: dense ? 78 : 110 }}>Games</Table.Th>
            <Table.Th>WDL</Table.Th>
            <Table.Th style={{ width: dense ? 64 : 82 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr
              key={row.key}
              style={{ cursor: "pointer" }}
              onClick={() => onPlay(row.move)}
              onMouseEnter={() => onPreview(row.move)}
              onMouseLeave={onClearPreview}
            >
              <Table.Td>
                <Text size={textSize} fw={700}>
                  {row.move}
                </Text>
                {row.lastPlayed ? (
                  <Text size="xs" c="dimmed">
                    {row.lastPlayed}
                  </Text>
                ) : null}
              </Table.Td>
              <Table.Td>
                <Text size={textSize}>{formatNumber(row.total)}</Text>
                <Text size="xs" c="dimmed">
                  {(row.share * 100).toFixed(0)}%
                </Text>
              </Table.Td>
              <Table.Td>
                <PrepResultBar row={row} />
              </Table.Td>
              <Table.Td>
                <Group gap={2} wrap="nowrap" justify="flex-end">
                  <Tooltip label={general ? "Play this database move" : "Play this reply"}>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPlay(row.move);
                      }}
                    >
                      <IconPlayerPlay size="0.95rem" />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function BranchStatsCell({
  stats,
  loading,
  dense,
}: {
  stats?: OpponentPrepBranchStats;
  loading: boolean;
  dense: boolean;
}) {
  if (!stats) {
    return (
      <Text size="xs" c="dimmed">
        {loading ? "Checking" : "-"}
      </Text>
    );
  }

  const color = branchStatsColor(stats.label);

  return (
    <Tooltip label={branchStatsTooltip(stats)} multiline w={290}>
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Group gap={4} wrap="nowrap">
          <Badge color={color} variant="light" size="sm">
            {stats.label}
          </Badge>
          <Text size="xs" fw={700}>
            {stats.score}%
          </Text>
        </Group>
        <Progress value={stats.score} color={color} size={dense ? 3 : "xs"} />
        <Text size="xs" c="dimmed" truncate>
          {Math.round(stats.replyCoverage * 100)}% replies - {stats.depthPly} ply
        </Text>
      </Stack>
    </Tooltip>
  );
}

function PrepResultBar({ row }: { row: Pick<Opening, "white" | "draw" | "black"> }) {
  const total = getOpeningTotal(row);
  const whitePercent = total > 0 ? (row.white / total) * 100 : 0;
  const drawPercent = total > 0 ? (row.draw / total) * 100 : 0;
  const blackPercent = total > 0 ? (row.black / total) * 100 : 0;

  return (
    <Progress.Root size="lg">
      <Progress.Section value={whitePercent} color="gray.2">
        <Progress.Label c="black">
          {whitePercent >= 18 ? `${whitePercent.toFixed(0)}%` : ""}
        </Progress.Label>
      </Progress.Section>
      <Progress.Section value={drawPercent} color="gray">
        <Progress.Label>{drawPercent >= 18 ? `${drawPercent.toFixed(0)}%` : ""}</Progress.Label>
      </Progress.Section>
      <Progress.Section value={blackPercent} color="dark">
        <Progress.Label>{blackPercent >= 18 ? `${blackPercent.toFixed(0)}%` : ""}</Progress.Label>
      </Progress.Section>
    </Progress.Root>
  );
}

function branchStatsTooltip(stats: OpponentPrepBranchStats) {
  const lines = [
    `${stats.label}: ${stats.score}%`,
    stats.depthPly > 0 ? `Depth: ${stats.depthPly} ply` : "No saved response in this branch yet.",
    stats.opponentPositions > 0
      ? `Covered ${Math.round(stats.replyCoverage * 100)}% of their shown reply frequency across ${stats.opponentPositions} opponent choice${stats.opponentPositions === 1 ? "" : "s"}.`
      : "Add more of your line to reach their next opponent choice.",
    stats.commonReplies > 0
      ? `${stats.preparedReplies}/${stats.commonReplies} shown replies prepared${stats.startedReplies > 0 ? `, ${stats.startedReplies} only started` : ""}.`
      : "",
    stats.missingImportantMoves.length > 0
      ? `Important gaps: ${stats.missingImportantMoves.join(", ")}`
      : "",
  ];

  return lines.filter(Boolean).join("\n");
}

function lichessMovesToOpenings(
  moves: {
    san: string;
    white: number;
    black: number;
    draws: number;
  }[],
): Opening[] {
  return moves.map((move) => ({
    move: move.san,
    white: move.white,
    black: move.black,
    draw: move.draws,
  }));
}

function mergePrepBuilderEngineMoves(moves: PrepBuilderEngineMove[]) {
  const bySan = new Map<string, PrepBuilderEngineMove>();

  for (const move of moves) {
    const key = normalizePrepBuilderSan(move.san);
    const existing = bySan.get(key);
    if (
      !existing ||
      prepBuilderEngineSourceRank(move.source) < prepBuilderEngineSourceRank(existing.source) ||
      ((move.rank ?? 99) < (existing.rank ?? 99) && move.source === existing.source)
    ) {
      bySan.set(key, move);
    }
  }

  return Array.from(bySan.values()).sort(
    (a, b) =>
      prepBuilderEngineSourceRank(a.source) - prepBuilderEngineSourceRank(b.source) ||
      (a.rank ?? 99) - (b.rank ?? 99) ||
      a.san.localeCompare(b.san),
  );
}

function prepBuilderEngineSourceRank(source: PrepBuilderEngineMove["source"]) {
  return source === "lichess" ? 0 : 1;
}

function formatPrepBuilderChoiceComment(choice: PrepBuilderMoveChoice) {
  return choice.reasons.map((reason) => `${reason}.`).join(" ");
}

function formatPrepBuilderOpponentComment({
  row,
  branchShare,
  general,
}: {
  row: OpponentPrepMoveRow;
  branchShare: number;
  general: boolean;
}) {
  const actor = general ? "Common reply" : "Opponent reply";
  return `${actor}: ${row.total} game${row.total === 1 ? "" : "s"}, move ${formatPrepBuilderPercent(
    row.share * 100,
  )}%, line ${formatPrepBuilderPercent(branchShare * 100)}%.`;
}

const PREP_BUILDER_COMMENT_PREFIX = "Prep Builder:";

function mergePrepBuilderComment(existing: string, comment: string) {
  const kept = existing
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(PREP_BUILDER_COMMENT_PREFIX));
  return [...kept, `${PREP_BUILDER_COMMENT_PREFIX} ${comment}`].join("\n\n");
}

function getPrepBuilderSafetyPositionLimit(size: PrepBuilderSettings["size"]) {
  switch (size) {
    case "quick":
      return 300;
    case "deep":
      return 2500;
    case "balanced":
      return 1200;
  }
}

function getPrepBuilderExplorerMoveLimit(moveLimit: number) {
  return Math.max(12, Math.min(100, moveLimit));
}

function getPrepBuilderBranchSearchMoveLimit(settings: PrepBuilderSettings) {
  return Math.max(100, settings.opponentMoveLimit);
}

function getPrepBuilderReferenceMoveLimit(moveLimit: number) {
  return Math.max(20, Math.min(100, moveLimit * 2));
}

function formatPrepBuilderPercent(percent: number) {
  if (percent >= 10) return Math.round(percent).toString();
  return percent.toFixed(1).replace(/\.0$/, "");
}

function normalizePrepBuilderSan(value: string) {
  return value
    .trim()
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O")
    .replace(/[+#?!]+$/g, "");
}

function getPrepBuilderSettingsPatch(
  current: Partial<PrepBuilderSettings> | undefined,
  patch: Partial<PrepBuilderSettings>,
) {
  const next = {
    ...current,
    ...patch,
  };

  if (patch.mode) {
    delete next.engineWeight;
    delete next.breadthBias;
    delete next.maxEngineCpLoss;
  }

  if (patch.size) {
    delete next.maxPly;
    delete next.opponentMoveLimit;
    delete next.minOpponentGames;
    delete next.minOpponentMoveShare;
    delete next.minBranchShare;
  }

  return next;
}

function getInitialPrepSeed({
  currentLocalOptions,
  localDatabases,
  referenceDb,
  savedCompareSettings,
}: {
  currentLocalOptions: {
    path: string | null;
    player: number | null;
    playerName?: string;
    color: "white" | "black";
    start_date?: string;
    end_date?: string;
    result: StoredDatabaseLocalOptions["result"];
  };
  localDatabases: SuccessDatabaseInfo[];
  referenceDb: string | null;
  savedCompareSettings?: {
    slots: {
      sourceValue: string | null;
      localOptions: StoredDatabaseLocalOptions;
    }[];
  };
}): Partial<OpponentPrepState> | null {
  const localPaths = new Set(localDatabases.map((database) => database.file));
  const compareSlot = savedCompareSettings?.slots.find(
    (slot) =>
      slot.sourceValue &&
      localPaths.has(slot.sourceValue) &&
      (slot.localOptions.player || slot.localOptions.playerName?.trim()),
  );

  if (compareSlot?.sourceValue) {
    const database = localDatabases.find((item) => item.file === compareSlot.sourceValue);
    return {
      mode: "player",
      source: "local",
      databasePath: compareSlot.sourceValue,
      databaseLabel: database ? database.title || database.filename : null,
      player: compareSlot.localOptions.player,
      playerName: compareSlot.localOptions.playerName ?? "",
      color: compareSlot.localOptions.color,
      start_date: compareSlot.localOptions.start_date,
      end_date: compareSlot.localOptions.end_date,
      result: compareSlot.localOptions.result,
    };
  }

  const databasePath =
    currentLocalOptions.path && localPaths.has(currentLocalOptions.path)
      ? currentLocalOptions.path
      : referenceDb && localPaths.has(referenceDb)
        ? referenceDb
        : localDatabases[0]?.file;
  if (!databasePath) return null;

  const database = localDatabases.find((item) => item.file === databasePath);
  return {
    source: "local",
    databasePath,
    databaseLabel: database ? database.title || database.filename : null,
    player: currentLocalOptions.player,
    playerName: currentLocalOptions.playerName ?? "",
    color: currentLocalOptions.color,
    start_date: currentLocalOptions.start_date,
    end_date: currentLocalOptions.end_date,
    result: currentLocalOptions.result,
  };
}

function getPrepSearchId(scope: string, fen: string) {
  return `opponent-prep|${scope}|${fen}`;
}

function statusColor(status: OpponentPrepMoveRow["status"]) {
  switch (status) {
    case "prepared":
      return "green";
    case "started":
      return "blue";
    case "skipped":
      return "gray";
    case "new":
      return "orange";
  }
}

function statusLabel(status: OpponentPrepMoveRow["status"]) {
  switch (status) {
    case "prepared":
      return "Done";
    case "started":
      return "Started";
    case "skipped":
      return "Skipped";
    case "new":
      return "New";
  }
}

function branchStatsColor(label: OpponentPrepBranchStats["label"]) {
  switch (label) {
    case "Good":
      return "green";
    case "Solid":
      return "teal";
    case "Needs work":
      return "yellow";
    case "Thin":
      return "orange";
    case "No line":
      return "gray";
  }
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

export default memo(OpponentPrepPanel);
