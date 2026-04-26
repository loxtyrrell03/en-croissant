import type { DrawShape } from "@lichess-org/chessground/draw";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconInfoCircle,
  IconDeviceFloppy,
  IconPlayerPause,
  IconPlayerPlay,
  IconPencil,
  IconPlus,
  IconPlayerStop,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { listen } from "@tauri-apps/api/event";
import { useLoaderData } from "@tanstack/react-router";
import { makeUci, parseUci, type Move, type SquareName } from "chessops";
import { chessgroundMove } from "chessops/compat";
import type { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr/immutable";
import {
  commands,
  events,
  type BestMoves,
  type OpeningHealthPlayerPosition,
  type RepertoireGap,
  type RepertoireGapReferenceMove,
  type RepertoireGapReport,
} from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { createOpeningHealthTrainingItem } from "@/components/files/opening";
import {
  activeTabAtom,
  currentBoardPreviewShapesAtom,
  currentTabAtom,
  deckAtomFamily,
  enginesAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  openingHealthLocalFallbackAtom,
  openingHealthScanAtom,
  openingHealthVerificationRunAtom,
  openingHealthVerificationsAtom,
  openingHealthVerifyDepthAtom,
  openingHealthVerifyDuringScanAtom,
  onlineDatabaseUpdatesAtom,
  type OpeningHealthVerification,
  type OpeningHealthVerificationStatus,
  type OpeningHealthProgress,
  referenceDbAtom,
  sessionsAtom,
} from "@/state/atoms";
import {
  cancelDatabaseSearch,
  getDatabases,
  query_players,
  setDatabaseSearchPaused,
  type SuccessDatabaseInfo,
} from "@/utils/db";
import { queryChessDbMoves, type ChessDbCloudMove } from "@/utils/chessdb/api";
import { formatNumber } from "@/utils/format";
import {
  getLichessGames,
  getMasterGames,
  queryLichessCloudMoves,
  type LichessCloudMove,
  type PositionData,
} from "@/utils/lichess/api";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
import { getTabGameNumber, getTabPracticeKey } from "@/utils/tabs";
import { positionFromFen } from "@/utils/chessops";
import type { Engine, LocalEngine } from "@/utils/engines";
import {
  createOpeningReviewDeck,
  getAvailableOpeningReviewDeckPath,
  type OpeningReviewAutoUpdateConfig,
  listOpeningReviewDecks,
  mergeOpeningReviewPositions,
  readOpeningReviewDeck,
  writeOpeningReviewDeck,
} from "@/utils/openingReview";
import {
  formatOpeningReviewLastPlayed,
  getOpeningReviewGapReason,
} from "@/utils/openingReviewAutoUpdate";
import {
  OPENING_HEALTH_DATE_RANGE_OPTIONS,
  formatOpeningHealthDateFilter,
  getOpeningHealthDateBounds,
  openingHealthDbDateToInput,
  openingHealthDateBoundsAreActive,
  openingHealthDateBoundsAreValid,
  type OpeningHealthDateBounds,
  type OpeningHealthDateRange,
} from "@/utils/openingHealthDateFilter";
import { getOnlineDatabaseUpdateRecord } from "@/utils/onlineGameImport";
import resultClasses from "../database/OpeningsTable.module.css";

type OpeningHealthMode = "opponent" | "self";
type OpeningHealthColorFilter = "any" | "white" | "black";
type OpeningHealthSortMode = "priority" | "frequency";
type OpeningHealthMovePreview = {
  san: string;
  beforeFen: string;
  afterFen: string;
  uci: string;
  orig: SquareName;
  dest: SquareName;
};
type OpeningHealthPreviewPayload = {
  fen: string;
  displayFen?: string;
  shapes: DrawShape[];
};
type OpeningHealthTrainingMove = {
  san: string;
  uci?: string | null;
};

const DEFAULT_MIN_PERSONAL_GAMES = 3;
const DEFAULT_MIN_REFERENCE_GAMES = 20;
const DEFAULT_MAX_PLIES = 30;
const DEFAULT_TOP_REFERENCE_MOVES = 3;
const LICHESS_ALL_SOURCE = "online:lichess-all";
const LICHESS_MASTER_SOURCE = "online:lichess-master";
const ONLINE_REFERENCE_CONCURRENCY = 3;
const ONLINE_REFERENCE_POSITION_LIMIT = 300;
const OPENING_HEALTH_MAX_REPORT_ROWS = 600;
const OPENING_HEALTH_SCORE_GAP = 0.15;
const OPENING_HEALTH_POOR_SCORE = 0.45;
const LICHESS_DEEP_VERIFY_LIMIT = 20;
const LICHESS_CLOUD_VERIFY_CONCURRENCY = 1;
const CHESSDB_VERIFY_CONCURRENCY = 16;
const CHESSDB_UNSCORED_MOVE_LOSS_CP = 280;
const ENGINE_SIGNIFICANT_DROP_CP = 50;
const ENGINE_VERIFY_MULTIPV = 5;
const ENGINE_VERIFY_TIMEOUT_MS = 45_000;
const ENGINE_VERIFY_PROGRESS_START = 99;
const ENGINE_VERIFY_PROGRESS_SPAN = 0.9;
const ENGINE_VERIFY_UI_THROTTLE_MS = 180;

type OnlineReferenceSource = typeof LICHESS_ALL_SOURCE | typeof LICHESS_MASTER_SOURCE;
type OpeningHealthProgressSample = Pick<
  OpeningHealthProgress,
  "finished" | "phase" | "progress"
> & {
  time: number;
};
type EngineVerificationStatus = OpeningHealthVerificationStatus;
type EngineVerification = OpeningHealthVerification;

const openingHealthScanControlState = { paused: false, stopRequested: false };
let openingHealthEngineVerificationControl: { engineId: string; tab: string } | null = null;

function RepertoireGapsPanel() {
  const store = useContext(TreeStateContext)!;
  const activeTab = useAtomValue(activeTabAtom);
  const currentTab = useAtomValue(currentTabAtom);
  const [deck, setDeck] = useAtom(
    deckAtomFamily({
      file: getTabPracticeKey(currentTab),
      game: getTabGameNumber(currentTab),
    }),
  );
  const storedReferenceDb = useAtomValue(referenceDbAtom);
  const lichessOptions = useAtomValue(lichessOptionsAtom);
  const masterOptions = useAtomValue(masterOptionsAtom);
  const engines = useAtomValue(enginesAtom);
  const sessions = useAtomValue(sessionsAtom);
  const onlineDatabaseUpdates = useAtomValue(onlineDatabaseUpdatesAtom);
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const { documentDir } = useLoaderData({ from: "/" });

  const { data: databases } = useSWR("databases", () => getDatabases());
  const localDatabases = useMemo(
    () =>
      (databases ?? []).filter((database): database is SuccessDatabaseInfo => {
        return database.type === "success";
      }),
    [databases],
  );

  const databaseOptions = useMemo(
    () =>
      localDatabases.map((database) => ({
        value: database.file,
        label: database.title || database.filename,
      })),
    [localDatabases],
  );
  const referenceOptions = useMemo(
    () => [
      ...databaseOptions,
      { value: LICHESS_ALL_SOURCE, label: "Lichess All" },
      { value: LICHESS_MASTER_SOURCE, label: "Lichess Masters" },
    ],
    [databaseOptions],
  );

  const [personalDb, setPersonalDb] = useState<string | null>(null);
  const [referenceDb, setReferenceDb] = useState<string | null>(storedReferenceDb);
  const [subjectPlayerId, setSubjectPlayerId] = useState<string | null>(null);
  const [subjectPlayerSearch, setSubjectPlayerSearch] = useState("");
  const [analysisMode, setAnalysisMode] = useState<OpeningHealthMode>("opponent");
  const colorFilter: OpeningHealthColorFilter = "any";
  const [sortMode, setSortMode] = useState<OpeningHealthSortMode>("priority");
  const [maxPlies, setMaxPlies] = useState(DEFAULT_MAX_PLIES);
  const [minPersonalGames, setMinPersonalGames] = useState(DEFAULT_MIN_PERSONAL_GAMES);
  const [minReferenceGames, setMinReferenceGames] = useState(DEFAULT_MIN_REFERENCE_GAMES);
  const [dateRange, setDateRange] = useState<OpeningHealthDateRange>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [engineVerifications, setEngineVerifications] = useAtom(openingHealthVerificationsAtom);
  const [engineVerificationRun, setEngineVerificationRun] = useAtom(
    openingHealthVerificationRunAtom,
  );
  const [verifyDuringScan, setVerifyDuringScan] = useAtom(openingHealthVerifyDuringScanAtom);
  const [localFallback, setLocalFallback] = useAtom(openingHealthLocalFallbackAtom);
  const [engineVerifyDepth, setEngineVerifyDepth] = useAtom(openingHealthVerifyDepthAtom);
  const [scan, setScan] = useAtom(openingHealthScanAtom);
  const setBoardPreviewShapes = useSetAtom(currentBoardPreviewShapesAtom);
  const [reviewSaveOpen, setReviewSaveOpen] = useState(false);
  const [reviewDeckMode, setReviewDeckMode] = useState<"new" | "existing">("new");
  const [reviewDeckName, setReviewDeckName] = useState("");
  const [reviewDeckPath, setReviewDeckPath] = useState<string | null>(null);
  const [reviewDeckLimit, setReviewDeckLimit] = useState(100);
  const [reviewAutoUpdate, setReviewAutoUpdate] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [dismissedGapKeys, setDismissedGapKeys] = useState<Set<string>>(() => new Set());
  const [correctMoveOverrides, setCorrectMoveOverrides] = useState<
    Record<string, OpeningHealthTrainingMove>
  >({});
  const [editingGap, setEditingGap] = useState<RepertoireGap | null>(null);
  const [now, setNow] = useState(Date.now());
  const { report, loading, requestId, progress } = scan;
  const scanDateBounds = useMemo(
    () => getOpeningHealthDateBounds(dateRange, customStartDate, customEndDate),
    [customEndDate, customStartDate, dateRange],
  );
  const { data: reviewDecks, mutate: mutateReviewDecks } = useSWR(
    reviewSaveOpen ? ["opening-review-decks", documentDir] : null,
    () => listOpeningReviewDecks(documentDir),
  );
  const modeCopy = getOpeningHealthModeCopy(analysisMode);
  const stockfishEngine = useMemo(() => selectOpeningHealthEngine(engines ?? []), [engines]);
  const boundedEngineVerifyDepth = Math.min(20, Math.max(4, Math.round(engineVerifyDepth) || 4));
  const scanControlRef = useRef(openingHealthScanControlState);
  const progressSamplesRef = useRef<OpeningHealthProgressSample[]>([]);
  const selectedPersonalDatabase = useMemo(
    () => localDatabases.find((database) => database.file === personalDb) ?? null,
    [localDatabases, personalDb],
  );
  const playerSearchSeed = useMemo(
    () => getOpeningHealthPlayerSearchSeed(selectedPersonalDatabase),
    [selectedPersonalDatabase],
  );
  const selectedOnlineUpdateRecord = useMemo(
    () =>
      selectedPersonalDatabase
        ? getOnlineDatabaseUpdateRecord(selectedPersonalDatabase, onlineDatabaseUpdates)
        : null,
    [onlineDatabaseUpdates, selectedPersonalDatabase],
  );
  const reviewAutoUpdateBlockedReason = useMemo(() => {
    if (!selectedOnlineUpdateRecord) {
      return "Use a Lichess or Chess.com games database to keep a deck updated automatically.";
    }
    if (!referenceDb) {
      return "Choose a strong-games source before enabling automatic deck updates.";
    }
    if (getOnlineReferenceSource(referenceDb)) {
      return "Automatic deck updates currently need a local strong-games source.";
    }
    return null;
  }, [referenceDb, selectedOnlineUpdateRecord]);
  const canAutoUpdateReviewDeck = !reviewAutoUpdateBlockedReason;
  const playerSearchTerm = subjectPlayerSearch.trim() || playerSearchSeed;
  const { data: subjectPlayers } = useSWR(
    personalDb ? ["opening-health-players", personalDb, playerSearchTerm] : null,
    ([, db, name]) =>
      query_players(db, {
        name,
        range: null,
        options: {
          skipCount: true,
          page: 1,
          pageSize: 80,
          sort: "name",
          direction: "asc",
        },
      }),
  );
  const subjectPlayerOptions = useMemo(
    () =>
      (subjectPlayers?.data ?? [])
        .filter((player) => player.name)
        .map((player) => ({
          value: String(player.id),
          label: player.name!,
        })),
    [subjectPlayers],
  );

  const recordProgressSample = useCallback(
    (nextProgress: OpeningHealthProgress, time = Date.now()) => {
      const sample = {
        time,
        progress: nextProgress.progress,
        phase: nextProgress.phase,
        finished: nextProgress.finished,
      };
      const samples = progressSamplesRef.current;
      const previous = samples[samples.length - 1];

      if (
        !previous ||
        previous.phase !== sample.phase ||
        sample.progress < previous.progress ||
        sample.finished
      ) {
        progressSamplesRef.current = [sample];
        return;
      }

      if (sample.progress > previous.progress || sample.time - previous.time >= 1000) {
        progressSamplesRef.current = [...samples, sample].filter(
          (entry) => sample.time - entry.time <= 30000,
        );
      }
    },
    [],
  );

  useEffect(() => {
    Object.assign(scanControlRef.current, {
      paused: scan.paused,
      stopRequested: scan.stopRequested,
    });
  }, [scan.paused, scan.stopRequested]);

  useEffect(() => {
    if (localDatabases.length === 0) return;
    setPersonalDb((current) => current ?? localDatabases[0]?.file ?? null);
    setReferenceDb((current) => {
      if (current) return current;
      return storedReferenceDb ?? localDatabases[1]?.file ?? localDatabases[0]?.file ?? null;
    });
  }, [localDatabases, storedReferenceDb]);

  useEffect(() => {
    setSubjectPlayerId(null);
    setSubjectPlayerSearch("");
  }, [personalDb]);

  useEffect(() => {
    if (!canAutoUpdateReviewDeck) {
      setReviewAutoUpdate(false);
    }
  }, [canAutoUpdateReviewDeck]);

  useEffect(() => {
    if (subjectPlayerId || subjectPlayerOptions.length === 0) return;

    const normalizedSeed = normalizeOpeningHealthPlayerName(playerSearchSeed);
    const exactMatch = subjectPlayerOptions.find(
      (player) => normalizeOpeningHealthPlayerName(player.label) === normalizedSeed,
    );
    setSubjectPlayerId(
      exactMatch?.value ??
        (subjectPlayerOptions.length === 1 ? subjectPlayerOptions[0]!.value : null),
    );
  }, [playerSearchSeed, subjectPlayerId, subjectPlayerOptions]);

  useEffect(() => {
    if (!requestId) return undefined;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    async function subscribe() {
      const unlisten = await listen<OpeningHealthProgress>(
        "opening_health_progress",
        ({ payload }) => {
          if (payload.id === requestId) {
            recordProgressSample(payload);
            setScan((current) =>
              current.requestId === payload.id ? { ...current, progress: payload } : current,
            );
          }
        },
      );

      if (disposed) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    }

    subscribe();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [recordProgressSample, requestId, setScan]);

  useEffect(() => {
    if (!loading) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [loading]);

  const rows = useMemo(() => report?.gaps ?? [], [report]);
  const activeRows = useMemo(
    () => rows.filter((gap) => !dismissedGapKeys.has(gapKey(gap))),
    [dismissedGapKeys, rows],
  );
  const visibleRows = useMemo(() => {
    return sortOpeningHealthRows(activeRows, engineVerifications, colorFilter, sortMode);
  }, [activeRows, colorFilter, engineVerifications, sortMode]);
  const verifiedCount = useMemo(
    () => Object.keys(engineVerifications).length,
    [engineVerifications],
  );
  const remainingVerificationCount = useMemo(
    () => visibleRows.filter((gap) => !engineVerifications[gapKey(gap)]).length,
    [engineVerifications, visibleRows],
  );

  const loadPosition = useCallback(
    (gap: RepertoireGap, fen = gap.fen) => {
      const state = store.getState();
      state.setHeaders({
        ...state.headers,
        fen,
        orientation: gap.sideToMove === "black" ? "black" : "white",
        result: "*",
      });
      state.goToStart();
    },
    [store],
  );
  const clearMovePreview = useCallback(() => {
    setBoardPreviewShapes(null);
  }, [setBoardPreviewShapes]);

  useEffect(() => clearMovePreview, [clearMovePreview]);

  async function analyze() {
    if (!personalDb || !referenceDb) {
      notifications.show({
        title: "Missing databases",
        message: `Choose ${modeCopy.databaseMissingText} and a strong-games source.`,
        color: "yellow",
      });
      return;
    }

    if (!subjectPlayerId) {
      notifications.show({
        title: "Choose a player",
        message: `Select ${modeCopy.subjectPlayerLabel.toLowerCase()} so the scan only counts that player's moves.`,
        color: "yellow",
      });
      return;
    }

    const playerId = Number(subjectPlayerId);

    const onlineReference = getOnlineReferenceSource(referenceDb);
    if (onlineReference && !explorerToken) {
      notifications.show({
        title: "Lichess login required",
        message: "Sign in to Lichess before using Lichess All or Lichess Masters here.",
        color: "yellow",
      });
      return;
    }

    if (!openingHealthDateBoundsAreValid(scanDateBounds)) {
      notifications.show({
        title: "Date range is invalid",
        message: "The start date must be before the end date.",
        color: "yellow",
      });
      return;
    }

    const id = `opening-health-${Date.now()}`;
    const startedAt = Date.now();
    const initialProgress = {
      id,
      progress: 0,
      gamesScanned: 0,
      positionsProcessed: 0,
      phase: "Starting scan",
      finished: false,
    };
    setNow(startedAt);
    progressSamplesRef.current = [];
    Object.assign(scanControlRef.current, { paused: false, stopRequested: false });
    setEngineVerifications({});
    setEngineVerificationRun(null);
    setDismissedGapKeys(new Set());
    setCorrectMoveOverrides({});
    setEditingGap(null);
    recordProgressSample(initialProgress, startedAt);
    setScan({
      requestId: id,
      loading: true,
      paused: false,
      stopRequested: false,
      report: null,
      progress: initialProgress,
      startedAt,
      completedAt: null,
      error: null,
    });

    const updateProgress = (nextProgress: OpeningHealthProgress) => {
      recordProgressSample(nextProgress);
      setScan((current) =>
        current.requestId === nextProgress.id ? { ...current, progress: nextProgress } : current,
      );
    };

    try {
      const result = onlineReference
        ? await analyzeOnlineReference({
            id,
            personalDb,
            playerId,
            source: onlineReference,
            explorerToken: explorerToken!,
            lichessOptions,
            masterOptions,
            maxPlies,
            colorFilter,
            minPersonalGames,
            minReferenceGames,
            dateBounds: scanDateBounds,
            setProgress: updateProgress,
            getControlState: () => scanControlRef.current,
          })
        : await commands.findRepertoireGaps({
            playerDb: personalDb,
            referenceDb,
            playerId,
            color: colorFilter,
            maxPlies,
            minPlayerGames: minPersonalGames,
            minReferenceGames,
            topReferenceMoves: DEFAULT_TOP_REFERENCE_MOVES,
            startDate: scanDateBounds.startDate,
            endDate: scanDateBounds.endDate,
            requestId: id,
          });

      if (result.status === "ok") {
        const reportWithGaps = result.data;
        let engineChecks: { completed: number; total: number; stopped: boolean } | null = null;
        const shouldVerifyDuringScan = verifyDuringScan && reportWithGaps.gaps.length > 0;

        if (shouldVerifyDuringScan) {
          setScan((current) =>
            current.requestId === id
              ? {
                  ...current,
                  report: reportWithGaps,
                  progress: {
                    id,
                    progress: ENGINE_VERIFY_PROGRESS_START,
                    gamesScanned: reportWithGaps.playerGames,
                    positionsProcessed: reportWithGaps.candidatePositions,
                    phase: "Validating",
                    finished: false,
                  },
                }
              : current,
          );

          const rowsToVerify = selectRowsForEngineVerification(
            reportWithGaps.gaps,
            {},
            colorFilter,
          );
          if (rowsToVerify.length > 0) {
            try {
              engineChecks = await runEngineVerification({
                rowsToVerify,
                engine: localFallback ? stockfishEngine : null,
                fallbackToLocalEngine: localFallback,
                depth: boundedEngineVerifyDepth,
                engineTab: `${activeTab ?? "opening-health"}:${id}:opening-health-verify`,
                requestId: id,
                progressReport: reportWithGaps,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              notifications.show({
                title: "Validation fallback stopped",
                message,
                color: "yellow",
              });
            }
          } else {
            engineChecks = { completed: 0, total: 0, stopped: false };
          }
        }

        if (engineChecks?.stopped || scanControlRef.current.stopRequested) {
          setScan((current) =>
            current.requestId === id
              ? {
                  ...current,
                  loading: false,
                  paused: false,
                  stopRequested: false,
                  report: reportWithGaps,
                  completedAt: Date.now(),
                  error: null,
                  progress: {
                    id,
                    progress: 100,
                    gamesScanned: reportWithGaps.playerGames,
                    positionsProcessed: reportWithGaps.candidatePositions,
                    phase: "Stopped",
                    finished: true,
                  },
                }
              : current,
          );
          return;
        }

        const completedAt = Date.now();
        setScan((current) =>
          current.requestId === id
            ? {
                ...current,
                loading: false,
                paused: false,
                stopRequested: false,
                report: reportWithGaps,
                completedAt,
                error: null,
                progress: {
                  id,
                  progress: 100,
                  gamesScanned: reportWithGaps.playerGames,
                  positionsProcessed: reportWithGaps.candidatePositions,
                  phase: "Done",
                  finished: true,
                },
              }
            : current,
        );
        const engineMessage =
          engineChecks && engineChecks.total > 0
            ? ` ${engineChecks.completed} checked with ChessDB; Lichess Cloud deep-checks only the top ${Math.min(
                LICHESS_DEEP_VERIFY_LIMIT,
                engineChecks.completed,
              )} priority rows${
                localFallback && stockfishEngine ? ` + ${stockfishEngine.name}` : ""
              }.${
                localFallback && !stockfishEngine
                  ? " Cloud misses were left for later because no local engine is loaded."
                  : ""
              }`
            : "";
        notifications.show({
          title: "Analyze Repertoire scan complete",
          message: `${reportWithGaps.gaps.length} flagged position${
            reportWithGaps.gaps.length === 1 ? "" : "s"
          } found.${engineMessage}`,
          color: "blue",
        });
      } else if (result.error !== "Search stopped") {
        setScan((current) =>
          current.requestId === id
            ? {
                ...current,
                loading: false,
                paused: false,
                stopRequested: false,
                completedAt: Date.now(),
                error: result.error,
              }
            : current,
        );
        notifications.show({
          title: "Analyze Repertoire scan failed",
          message: result.error,
          color: "red",
        });
      } else {
        setScan((current) =>
          current.requestId === id
            ? {
                ...current,
                loading: false,
                paused: false,
                stopRequested: false,
                completedAt: Date.now(),
                error: null,
              }
            : current,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScan((current) =>
        current.requestId === id
          ? {
              ...current,
              loading: false,
              paused: false,
              stopRequested: false,
              completedAt: Date.now(),
              error: message,
            }
          : current,
      );
      notifications.show({
        title: "Analyze Repertoire scan failed",
        message,
        color: "red",
      });
    }
  }

  async function togglePause() {
    if (!requestId || !loading || isOpeningHealthFinalizing(progress)) return;
    const paused = !scan.paused;
    Object.assign(scanControlRef.current, {
      ...scanControlRef.current,
      paused,
    });
    setScan((current) =>
      current.requestId === requestId
        ? {
            ...current,
            paused,
            progress: current.progress
              ? {
                  ...current.progress,
                  phase: paused ? "Paused" : "Resuming",
                }
              : current.progress,
          }
        : current,
    );
    await setDatabaseSearchPaused(requestId, paused);
  }

  async function stopScan() {
    if (!requestId || !loading || isOpeningHealthFinalizing(progress)) return;
    Object.assign(scanControlRef.current, {
      paused: false,
      stopRequested: true,
    });
    setScan((current) =>
      current.requestId === requestId
        ? {
            ...current,
            loading: false,
            paused: false,
            stopRequested: true,
            completedAt: Date.now(),
            progress: current.progress
              ? {
                  ...current.progress,
                  phase: "Stopped",
                  finished: true,
                }
              : current.progress,
          }
        : current,
    );
    const verificationControl = openingHealthEngineVerificationControl;
    if (verificationControl) {
      await commands.killEngine(verificationControl.engineId, verificationControl.tab);
      openingHealthEngineVerificationControl = null;
    }
    await cancelDatabaseSearch(requestId);
  }

  function addToTraining(gap: RepertoireGap, suggestedMove: OpeningHealthTrainingMove) {
    const item = createOpeningHealthTrainingItem(gap, suggestedMove);
    if (!item) {
      notifications.show({
        title: "No suggested move",
        message: "This position does not have a suggested move to train.",
        color: "yellow",
      });
      return;
    }

    const exists = deck.positions.some(
      (position) => position.fen === item.fen && position.answer === item.answer,
    );
    if (exists) {
      notifications.show({
        title: "Already in training",
        message: `${item.answer} is already saved for this position.`,
        color: "yellow",
      });
      return;
    }

    setDeck((current) => ({
      ...current,
      positions: [...current.positions, item],
    }));
    notifications.show({
      title: "Added to training",
      message: `${item.answer} was added to this deck.`,
      color: "green",
    });
  }

  function openReviewSaveModal() {
    const playerName =
      subjectPlayerOptions.find((option) => option.value === subjectPlayerId)?.label ||
      playerSearchSeed ||
      "Analyze Repertoire";
    const date = new Date().toISOString().slice(0, 10);
    setReviewDeckName(`${analysisMode === "self" ? "My gaps" : "Prep"} - ${playerName} - ${date}`);
    setReviewDeckMode((reviewDecks?.length ?? 0) > 0 ? "existing" : "new");
    setReviewDeckPath(reviewDecks?.[0]?.path ?? null);
    setReviewAutoUpdate(canAutoUpdateReviewDeck);
    setReviewSaveOpen(true);
  }

  async function saveReviewDeck() {
    const positions = visibleRows
      .slice(0, reviewDeckLimit > 0 ? reviewDeckLimit : undefined)
      .map((gap) =>
        createOpeningHealthReviewPosition(
          gap,
          engineVerifications[gapKey(gap)],
          analysisMode,
          correctMoveOverrides[gapKey(gap)],
          scanDateBounds,
        ),
      )
      .filter((position): position is NonNullable<typeof position> => Boolean(position));

    if (positions.length === 0) {
      notifications.show({
        title: "No trainable positions",
        message: "The visible rows do not have a clear move to train.",
        color: "yellow",
      });
      return;
    }

    setReviewSaving(true);
    try {
      const source = selectedPersonalDatabase?.title || selectedPersonalDatabase?.filename;
      const playerName =
        subjectPlayerOptions.find((option) => option.value === subjectPlayerId)?.label ||
        playerSearchSeed ||
        null;
      const autoUpdateConfig =
        reviewAutoUpdate && selectedOnlineUpdateRecord && personalDb && referenceDb
          ? createOpeningReviewAutoUpdateConfig({
              record: selectedOnlineUpdateRecord,
              playerDb: personalDb,
              playerId: subjectPlayerId ? Number(subjectPlayerId) : null,
              playerName,
              referenceDb,
              mode: analysisMode,
              maxPlies,
              minPlayerGames: minPersonalGames,
              minReferenceGames,
              dateBounds: scanDateBounds,
            })
          : null;
      if (reviewDeckMode === "existing") {
        if (!reviewDeckPath) {
          throw new Error("Choose an existing review deck.");
        }
        const existing = await readOpeningReviewDeck(reviewDeckPath);
        const merged = mergeOpeningReviewPositions(existing, positions);
        await writeOpeningReviewDeck(reviewDeckPath, {
          ...merged,
          mode: existing.mode ?? analysisMode,
          source: existing.source ?? source,
          autoUpdate: autoUpdateConfig ?? existing.autoUpdate,
        });
        notifications.show({
          title: "Review deck updated",
          message: `${positions.length} position${positions.length === 1 ? "" : "s"} merged into ${existing.name}. Existing review progress was kept.`,
          color: "green",
        });
      } else {
        const path = await getAvailableOpeningReviewDeckPath(documentDir, reviewDeckName);
        const deck = createOpeningReviewDeck({
          name: reviewDeckName || "Opening Review",
          mode: analysisMode,
          source,
          autoUpdate: autoUpdateConfig ?? undefined,
          positions,
        });
        await writeOpeningReviewDeck(path, deck);
        notifications.show({
          title: "Review deck saved",
          message: `${positions.length} position${positions.length === 1 ? "" : "s"} saved. Open it from Opening Review on the home page.`,
          color: "green",
        });
      }
      setReviewSaveOpen(false);
      await mutateReviewDecks();
    } catch (error) {
      notifications.show({
        title: "Could not save review deck",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setReviewSaving(false);
    }
  }

  async function runEngineVerification({
    rowsToVerify,
    engine,
    fallbackToLocalEngine,
    depth,
    engineTab,
    requestId: verificationRequestId,
    progressReport,
  }: {
    rowsToVerify: RepertoireGap[];
    engine: LocalEngine | null;
    fallbackToLocalEngine: boolean;
    depth: number;
    engineTab: string;
    requestId?: string;
    progressReport?: RepertoireGapReport;
  }): Promise<{ completed: number; total: number; stopped: boolean }> {
    const stats = {
      completed: 0,
      total: rowsToVerify.length,
      lichess: 0,
      chessdb: 0,
      local: 0,
      missing: 0,
      phase: "bulk" as "bulk" | "deep" | "engine",
    };

    setEngineVerificationRun({
      running: true,
      phase: stats.phase,
      completed: 0,
      total: rowsToVerify.length,
      engineName: fallbackToLocalEngine ? (engine?.name ?? null) : null,
      depth,
      lichess: 0,
      chessdb: 0,
      local: 0,
      missing: 0,
    });
    if (engine && fallbackToLocalEngine) {
      openingHealthEngineVerificationControl = { engineId: engine.id, tab: engineTab };
    }

    const bestMovesByFen = new Map<string, BestMoves[]>();
    const verificationByKey = new Map<string, EngineVerification>();
    const verificationSourceByKey = new Map<string, "lichess" | "chessdb" | "local" | "missing">();
    const pendingVerificationUpdates: Record<string, EngineVerification> = {};
    let lastVerificationFlushAt = 0;
    let lastRunUpdateAt = 0;
    let primaryScanCompleted = false;
    const rowsByFen = new Map<string, RepertoireGap[]>();
    for (const gap of rowsToVerify) {
      rowsByFen.set(gap.fen, [...(rowsByFen.get(gap.fen) ?? []), gap]);
    }
    const fenGroups = Array.from(rowsByFen.entries());
    const localFallbackRows: RepertoireGap[] = [];

    const updateEngineVerificationProgress = (nextCompleted: number) => {
      if (!verificationRequestId || !progressReport) return;
      if (primaryScanCompleted) return;
      const nextProgress = {
        id: verificationRequestId,
        progress:
          ENGINE_VERIFY_PROGRESS_START +
          (nextCompleted / Math.max(1, rowsToVerify.length)) * ENGINE_VERIFY_PROGRESS_SPAN,
        gamesScanned: progressReport.playerGames,
        positionsProcessed: progressReport.candidatePositions,
        phase: "Validating",
        finished: false,
      };
      recordProgressSample(nextProgress);
      setScan((current) =>
        current.requestId === verificationRequestId
          ? {
              ...current,
              progress: nextProgress,
            }
          : current,
      );
    };

    const flushVerificationUpdates = (force = false) => {
      const pendingKeys = Object.keys(pendingVerificationUpdates);
      if (pendingKeys.length === 0) return;
      const now = Date.now();
      if (!force && now - lastVerificationFlushAt < ENGINE_VERIFY_UI_THROTTLE_MS) return;

      const updates = { ...pendingVerificationUpdates };
      for (const key of pendingKeys) {
        delete pendingVerificationUpdates[key];
      }
      lastVerificationFlushAt = now;
      setEngineVerifications((current) => ({
        ...current,
        ...updates,
      }));
    };

    const updateVerificationRun = (force = false) => {
      const now = Date.now();
      if (!force && now - lastRunUpdateAt < ENGINE_VERIFY_UI_THROTTLE_MS) return;
      lastRunUpdateAt = now;
      setEngineVerificationRun({
        running: true,
        phase: stats.phase,
        completed: stats.completed,
        total: stats.total,
        engineName: fallbackToLocalEngine ? (engine?.name ?? null) : null,
        depth,
        lichess: stats.lichess,
        chessdb: stats.chessdb,
        local: stats.local,
        missing: stats.missing,
      });
      updateEngineVerificationProgress(stats.completed);
    };

    const finishPrimaryScanAfterBulkValidation = () => {
      if (!verificationRequestId || !progressReport || primaryScanCompleted) return;
      primaryScanCompleted = true;
      const completedAt = Date.now();
      const doneProgress = {
        id: verificationRequestId,
        progress: 100,
        gamesScanned: progressReport.playerGames,
        positionsProcessed: progressReport.candidatePositions,
        phase: "Done",
        finished: true,
      };
      recordProgressSample(doneProgress, completedAt);
      setScan((current) =>
        current.requestId === verificationRequestId
          ? {
              ...current,
              loading: false,
              paused: false,
              stopRequested: false,
              completedAt,
              error: null,
              progress: doneProgress,
            }
          : current,
      );
    };

    const getVerificationCounter = (verification: EngineVerification) =>
      verification.status === "missing" ? "missing" : verification.source;

    const adjustVerificationCounter = (
      counter: "lichess" | "chessdb" | "local" | "missing",
      delta: 1 | -1,
    ) => {
      stats[counter] += delta;
    };

    const markVerification = (
      gap: RepertoireGap,
      verification: EngineVerification,
      countsAsCompleted = true,
    ) => {
      const key = gapKey(gap);
      const previousCounter = verificationSourceByKey.get(key);
      const nextCounter = getVerificationCounter(verification);
      if (previousCounter) {
        adjustVerificationCounter(previousCounter, -1);
      }
      adjustVerificationCounter(nextCounter, 1);
      verificationSourceByKey.set(key, nextCounter);
      verificationByKey.set(key, verification);
      if (countsAsCompleted && !previousCounter) {
        stats.completed += 1;
      }

      pendingVerificationUpdates[key] = verification;
      flushVerificationUpdates();
      updateVerificationRun();
    };

    const waitIfNeeded = async () => {
      if (!verificationRequestId) return false;
      const waitResult = await waitForOpeningHealthResume(() => scanControlRef.current);
      return waitResult === "stopped";
    };

    try {
      let chessDbGroupCursor = 0;
      async function checkChessDbGroups() {
        while (chessDbGroupCursor < fenGroups.length) {
          if (await waitIfNeeded()) return;

          const group = fenGroups[chessDbGroupCursor];
          chessDbGroupCursor += 1;
          if (!group) continue;

          const [fen, gapsForFen] = group;
          let cloudMoves: ChessDbCloudMove[] | null = null;
          try {
            cloudMoves = await queryChessDbMoves(fen);
          } catch {
            cloudMoves = null;
          }

          for (const gap of gapsForFen) {
            const chessDbVerification = cloudMoves
              ? buildChessDbCloudVerification(gap, cloudMoves)
              : null;
            if (chessDbVerification) {
              markVerification(gap, chessDbVerification);
            } else {
              markVerification(gap, buildMissingCloudVerification());
              if (fallbackToLocalEngine && engine) {
                localFallbackRows.push(gap);
              }
            }
          }
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(CHESSDB_VERIFY_CONCURRENCY, fenGroups.length) },
          () => checkChessDbGroups(),
        ),
      );
      flushVerificationUpdates(true);
      updateVerificationRun(true);
      finishPrimaryScanAfterBulkValidation();

      if (scanControlRef.current.stopRequested) {
        return { completed: stats.completed, total: stats.total, stopped: true };
      }

      stats.phase = "deep";
      updateVerificationRun(true);
      const lichessRows = selectRowsForLichessDeepVerification(rowsToVerify, verificationByKey);
      const lichessRowsByFen = new Map<string, RepertoireGap[]>();
      for (const gap of lichessRows) {
        lichessRowsByFen.set(gap.fen, [...(lichessRowsByFen.get(gap.fen) ?? []), gap]);
      }
      const lichessFenGroups = Array.from(lichessRowsByFen.entries());

      let lichessGroupCursor = 0;
      async function checkLichessGroups() {
        while (lichessGroupCursor < lichessFenGroups.length) {
          if (await waitIfNeeded()) return;

          const group = lichessFenGroups[lichessGroupCursor];
          lichessGroupCursor += 1;
          if (!group) continue;

          const [fen, gapsForFen] = group;
          let lichessMoves: LichessCloudMove[] | null = null;
          try {
            lichessMoves = await queryLichessCloudMoves(fen, ENGINE_VERIFY_MULTIPV);
          } catch {
            lichessMoves = null;
          }

          if (!lichessMoves) continue;

          for (const gap of gapsForFen) {
            const lichessVerification = buildLichessCloudVerification(gap, lichessMoves);
            if (!lichessVerification) continue;

            const key = gapKey(gap);
            markVerification(gap, lichessVerification, !verificationByKey.has(key));
            const localIndex = localFallbackRows.findIndex((row) => gapKey(row) === key);
            if (localIndex >= 0) {
              localFallbackRows.splice(localIndex, 1);
            }
          }
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(LICHESS_CLOUD_VERIFY_CONCURRENCY, lichessFenGroups.length) },
          () => checkLichessGroups(),
        ),
      );
      flushVerificationUpdates(true);
      updateVerificationRun(true);

      if (scanControlRef.current.stopRequested) {
        return { completed: stats.completed, total: stats.total, stopped: true };
      }

      if (fallbackToLocalEngine && engine) {
        stats.phase = "engine";
        updateVerificationRun(true);
        localFallbackRows.sort(
          (a, b) =>
            openingHealthUrgency(b, verificationByKey.get(gapKey(b))) -
              openingHealthUrgency(a, verificationByKey.get(gapKey(a))) ||
            b.playerPositionGames - a.playerPositionGames ||
            a.ply - b.ply,
        );

        for (const gap of localFallbackRows) {
          const key = gapKey(gap);
          const existingVerification = verificationByKey.get(key);
          if (existingVerification && existingVerification.status !== "missing") continue;
          if (await waitIfNeeded()) {
            return { completed: stats.completed, total: stats.total, stopped: true };
          }

          let bestMoves: BestMoves[];
          try {
            const cachedBestMoves = bestMovesByFen.get(gap.fen);
            if (cachedBestMoves) {
              bestMoves = cachedBestMoves;
            } else {
              bestMoves = await getOpeningHealthEngineLines(engine, engineTab, gap.fen, depth);
              bestMovesByFen.set(gap.fen, bestMoves);
            }
          } catch (error) {
            if (scanControlRef.current.stopRequested) {
              return { completed: stats.completed, total: stats.total, stopped: true };
            }
            throw error;
          }

          markVerification(gap, buildEngineVerification(gap, bestMoves, depth), !existingVerification);
          await commands.killEngine(engine.id, engineTab);
        }
      } else {
        for (const gap of localFallbackRows) {
          if (verificationByKey.has(gapKey(gap))) continue;
          markVerification(gap, buildMissingCloudVerification());
        }
      }

      flushVerificationUpdates(true);
      updateVerificationRun(true);
      return { completed: stats.completed, total: stats.total, stopped: false };
    } finally {
      flushVerificationUpdates(true);
      if (engine && fallbackToLocalEngine) {
        await commands.killEngine(engine.id, engineTab);
        if (openingHealthEngineVerificationControl?.tab === engineTab) {
          openingHealthEngineVerificationControl = null;
        }
      }
      setEngineVerificationRun((current) =>
        current
          ? {
              ...current,
              running: false,
            }
          : current,
      );
    }
  }

  async function verifyTopRows() {
    if (engineVerificationRun?.running) return;

    const rowsToVerify = selectRowsForEngineVerification(
      activeRows,
      engineVerifications,
      colorFilter,
    );
    if (rowsToVerify.length === 0) {
      notifications.show({
        title: "Validation complete",
        message: "All visible flagged rows are already checked.",
        color: "blue",
      });
      return;
    }

    const engineTab = `${activeTab ?? "opening-health"}:opening-health-verify`;

    try {
      const result = await runEngineVerification({
        rowsToVerify,
        engine: localFallback ? stockfishEngine : null,
        fallbackToLocalEngine: localFallback,
        depth: boundedEngineVerifyDepth,
        engineTab,
      });
      const fallbackMessage =
        localFallback && !stockfishEngine
          ? " Local engine fallback skipped because no local engine is loaded."
          : "";
      notifications.show({
        title: "Validation complete",
        message: `${result.completed} position${
          result.completed === 1 ? "" : "s"
        } checked with ChessDB; Lichess Cloud deep-checks only the top ${Math.min(
          LICHESS_DEEP_VERIFY_LIMIT,
          result.completed,
        )} priority row${Math.min(LICHESS_DEEP_VERIFY_LIMIT, result.completed) === 1 ? "" : "s"}${
          result.total > result.completed ? ` (${result.total - result.completed} left)` : ""
        }.${fallbackMessage}`,
        color: "blue",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notifications.show({
        title: "Validation failed",
        message,
        color: "red",
      });
    }
  }

  const finalizing = loading && isOpeningHealthFinalizing(progress);
  const progressValue = progress?.progress ?? 0;
  const timingText = getOpeningHealthTimingText(
    scan.startedAt,
    scan.completedAt,
    now,
    progress,
    loading,
    progressSamplesRef.current,
  );
  const editingGapKey = editingGap ? gapKey(editingGap) : null;
  const editingMove =
    editingGap && editingGapKey
      ? (correctMoveOverrides[editingGapKey] ??
        getOpeningHealthTrainingMove(editingGap, engineVerifications[editingGapKey], analysisMode))
      : null;
  const verificationRunText = engineVerificationRun
    ? engineVerificationRun.phase === "deep"
      ? `Deep-checking top rows, ${engineVerificationRun.chessdb} ChessDB${
          engineVerificationRun.lichess > 0 ? `, ${engineVerificationRun.lichess} Lichess` : ""
        }${engineVerificationRun.missing > 0 ? `, ${engineVerificationRun.missing} missing` : ""}`
      : engineVerificationRun.phase === "engine"
        ? `Engine fallback, ${engineVerificationRun.completed}/${engineVerificationRun.total}${
            engineVerificationRun.local > 0 ? `, ${engineVerificationRun.local} engine` : ""
          }`
        : `Validating ${engineVerificationRun.completed}/${engineVerificationRun.total}${
            engineVerificationRun.chessdb > 0 ? `, ${engineVerificationRun.chessdb} ChessDB` : ""
          }${engineVerificationRun.missing > 0 ? `, ${engineVerificationRun.missing} missing` : ""}`
    : null;

  return (
    <>
      <Stack h="100%" gap="xs" p="sm">
        <Paper withBorder p="xs">
          <Stack gap="xs">
            <Group align="flex-end" justify="space-between" gap="sm">
              <Stack gap={4}>
                <Text size="sm" fw={700}>
                  Mode
                </Text>
                <SegmentedControl
                  value={analysisMode}
                  onChange={(value) => setAnalysisMode(value as OpeningHealthMode)}
                  data={[
                    { value: "opponent", label: "Prep vs opponent" },
                    { value: "self", label: "Find my gaps" },
                  ]}
                />
              </Stack>
              <Text size="sm" c="dimmed" maw={520}>
                {modeCopy.description}
              </Text>
            </Group>

            <Group grow align="flex-end">
              <Select
                label={modeCopy.personalDatabaseLabel}
                data={databaseOptions}
                value={personalDb}
                onChange={setPersonalDb}
                searchable
                allowDeselect={false}
              />
              <Select
                label={modeCopy.subjectPlayerLabel}
                data={subjectPlayerOptions}
                value={subjectPlayerId}
                onChange={setSubjectPlayerId}
                searchValue={subjectPlayerSearch}
                onSearchChange={setSubjectPlayerSearch}
                placeholder={playerSearchSeed || "Search player"}
                searchable
                allowDeselect={false}
              />
              <Select
                label="Strong games source"
                data={referenceOptions}
                value={referenceDb}
                onChange={setReferenceDb}
                searchable
                allowDeselect={false}
              />
            </Group>

            <Group align="flex-end">
              <Select
                label="Player games date"
                value={dateRange}
                onChange={(value) => setDateRange((value as OpeningHealthDateRange) ?? "all")}
                data={OPENING_HEALTH_DATE_RANGE_OPTIONS}
                allowDeselect={false}
                w={190}
              />
              {dateRange === "custom" && (
                <>
                  <TextInput
                    label="From"
                    type="date"
                    value={openingHealthDbDateToInput(customStartDate)}
                    onChange={(event) => setCustomStartDate(event.currentTarget.value)}
                    w={150}
                  />
                  <TextInput
                    label="To"
                    type="date"
                    value={openingHealthDbDateToInput(customEndDate)}
                    onChange={(event) => setCustomEndDate(event.currentTarget.value)}
                    w={150}
                  />
                </>
              )}
              {openingHealthDateBoundsAreActive(scanDateBounds) && (
                <Badge variant="light" mb={6}>
                  {formatOpeningHealthDateFilter(scanDateBounds)}
                </Badge>
              )}
            </Group>

            <Group align="flex-end">
              <NumberInput
                label={modeCopy.minimumGamesLabel}
                value={minPersonalGames}
                onChange={(value) => setMinPersonalGames(Math.max(1, Number(value) || 1))}
                min={1}
                w={180}
              />
              <NumberInput
                label="Minimum strong games"
                value={minReferenceGames}
                onChange={(value) => setMinReferenceGames(Math.max(1, Number(value) || 1))}
                min={1}
                w={185}
              />
              <NumberInput
                label="Opening ply"
                value={maxPlies}
                onChange={(value) => setMaxPlies(Math.min(80, Math.max(2, Number(value) || 2)))}
                min={2}
                max={80}
                w={120}
              />
              <Stack gap={4} miw={180}>
                <Group gap={4}>
                  <Text size="sm" fw={500}>
                    Cloud validation
                  </Text>
                  <Tooltip
                    label={`During the scan, ChessDB validates the bulk list first. Lichess Cloud is used as a deeper upgrade for the top ${LICHESS_DEEP_VERIFY_LIMIT} priority rows only. If neither has usable coverage, the local engine fallback can analyze that position.`}
                    multiline
                    maw={280}
                    withArrow
                  >
                    <ActionIcon
                      aria-label="Cloud validation help"
                      size="xs"
                      variant="subtle"
                      color="gray"
                    >
                      <IconInfoCircle size="0.8rem" />
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <Switch
                  checked={verifyDuringScan}
                  onChange={(event) => setVerifyDuringScan(event.currentTarget.checked)}
                  label="During scan"
                />
                <Switch
                  checked={localFallback}
                  onChange={(event) => setLocalFallback(event.currentTarget.checked)}
                  label="Engine fallback"
                  disabled={!verifyDuringScan}
                />
              </Stack>
              <NumberInput
                label="Fallback depth"
                value={engineVerifyDepth}
                onChange={(value) =>
                  setEngineVerifyDepth(Math.min(20, Math.max(4, Math.round(Number(value) || 4))))
                }
                min={4}
                max={20}
                w={125}
                disabled={!verifyDuringScan || !localFallback}
              />
              <Button
                leftSection={<IconSearch size="1rem" />}
                onClick={analyze}
                loading={loading}
                disabled={(engineVerificationRun?.running ?? false) && !loading}
              >
                Run scan
              </Button>
              {loading && !finalizing && (
                <>
                  <Button
                    variant="light"
                    leftSection={
                      scan.paused ? <IconPlayerPlay size="1rem" /> : <IconPlayerPause size="1rem" />
                    }
                    onClick={togglePause}
                  >
                    {scan.paused ? "Resume" : "Pause"}
                  </Button>
                  <Button
                    color="red"
                    variant="light"
                    leftSection={<IconPlayerStop size="1rem" />}
                    onClick={stopScan}
                  >
                    Stop
                  </Button>
                </>
              )}
            </Group>
          </Stack>
        </Paper>

        <Progress value={progressValue} animated={loading && progressValue === 0} size="xs" />

        {progress && (loading || progress.finished) && (
          <Group gap="xs">
            <Badge variant="light">{finalizing ? "Finalizing report" : progress.phase}</Badge>
            <Badge variant="light">{formatNumber(progress.gamesScanned)} games scanned</Badge>
            <Badge variant="light">{formatNumber(progress.positionsProcessed)} positions</Badge>
            {timingText && <Badge variant="light">{timingText}</Badge>}
          </Group>
        )}

        {report && (
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Group gap="xs">
              <Badge variant="light">
                {formatNumber(report.playerGames)} {modeCopy.gamesBadge}
              </Badge>
              <Badge variant="light">{formatNumber(report.candidatePositions)} lines checked</Badge>
              <Badge variant="light">
                {formatNumber(report.referencePositions)} found in strong games
              </Badge>
              <Badge color="orange" variant="light">
                {formatNumber(activeRows.length)} {modeCopy.flaggedBadge}
              </Badge>
              {dismissedGapKeys.size > 0 && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setDismissedGapKeys(new Set())}
                >
                  Show {dismissedGapKeys.size} hidden
                </Button>
              )}
            </Group>

            <Group gap="xs">
              <Button
                size="xs"
                variant="light"
                leftSection={<IconDeviceFloppy size="1rem" />}
                onClick={openReviewSaveModal}
                disabled={visibleRows.length === 0}
              >
                Save review deck
              </Button>
              <Badge variant="light">
                {sortMode === "frequency" ? "Sorted by frequency" : "Ranked by urgency"}
                {verifiedCount > 0 ? ` + ${verifiedCount} validated` : ""}
              </Badge>
              <Select
                size="xs"
                w={150}
                aria-label="Sort analyze repertoire rows"
                value={sortMode}
                onChange={(value) => setSortMode((value as OpeningHealthSortMode) ?? "priority")}
                data={[
                  { value: "priority", label: "Sort: priority" },
                  { value: "frequency", label: "Sort: frequency" },
                ]}
                allowDeselect={false}
              />
              {engineVerificationRun?.running && (
                <Badge color="blue" variant="light">
                  {verificationRunText}
                </Badge>
              )}
              <Tooltip
                label={`Checks every visible flagged row with ChessDB first, then uses Lichess Cloud as a deeper upgrade for the top ${LICHESS_DEEP_VERIFY_LIMIT} priority rows. If enabled, misses fall back to ${stockfishEngine?.name ?? "a loaded local engine"} at depth ${boundedEngineVerifyDepth}. Small engine nudges are light; drops over half a pawn push rows up sharply.`}
                multiline
                maw={280}
                withArrow
              >
                <Button
                  size="xs"
                  variant="light"
                  onClick={verifyTopRows}
                  loading={engineVerificationRun?.running ?? false}
                  disabled={remainingVerificationCount === 0}
                >
                  {engineVerificationRun?.running
                    ? `Verifying ${engineVerificationRun.completed}/${engineVerificationRun.total}`
                    : `Validate remaining ${remainingVerificationCount}`}
                </Button>
              </Tooltip>
            </Group>
          </Group>
        )}

        {!report && !loading && (
          <Alert color="blue" variant="light">
            {modeCopy.emptyText}
          </Alert>
        )}

        {report && activeRows.length === 0 && (
          <Alert color="green" variant="light">
            {dismissedGapKeys.size > 0
              ? "All flagged lines are hidden for this scan."
              : "No lines were flagged with these settings."}
          </Alert>
        )}

        {visibleRows.length > 0 && (
          <ScrollArea flex={1} offsetScrollbars>
            <Table withTableBorder highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ minWidth: 230 }}>
                    <ColumnHeader label="Priority" help={modeCopy.priorityHelp} />
                  </Table.Th>
                  <Table.Th style={{ minWidth: 240 }}>
                    <ColumnHeader label="Opening line" help={modeCopy.lineHelp} />
                  </Table.Th>
                  <Table.Th style={{ width: 135 }}>
                    <ColumnHeader label={modeCopy.playedColumnLabel} help={modeCopy.playedHelp} />
                  </Table.Th>
                  <Table.Th style={{ width: 150 }}>
                    <ColumnHeader
                      label={modeCopy.nextStepColumnLabel}
                      help={modeCopy.nextStepHelp}
                    />
                  </Table.Th>
                  <Table.Th style={{ width: 145 }}>
                    <ColumnHeader label="Evidence" help={modeCopy.evidenceHelp} />
                  </Table.Th>
                  <Table.Th style={{ minWidth: 240 }}>
                    <ColumnHeader label="Result" help={modeCopy.resultHelp} />
                  </Table.Th>
                  <Table.Th style={{ width: 112 }}>
                    <ColumnHeader label="Actions" help={modeCopy.saveHelp} />
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleRows.map((gap) => (
                  <OpeningHealthRow
                    key={`${gap.normalizedFen}|${gap.playerMoveUci}`}
                    gap={gap}
                    mode={analysisMode}
                    verification={engineVerifications[gapKey(gap)]}
                    correctMoveOverride={correctMoveOverrides[gapKey(gap)]}
                    onLoad={(fen) => loadPosition(gap, fen)}
                    onPreview={(preview) => setBoardPreviewShapes(preview)}
                    onClearPreview={clearMovePreview}
                    onAddTraining={(suggestedMove) => addToTraining(gap, suggestedMove)}
                    onEditMove={() => setEditingGap(gap)}
                    onDismiss={() =>
                      setDismissedGapKeys((current) => new Set(current).add(gapKey(gap)))
                    }
                  />
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
      <OpeningHealthMoveEditModal
        gap={editingGap}
        currentMove={editingMove}
        onClose={() => setEditingGap(null)}
        onSave={(move) => {
          if (!editingGap) return;
          const key = gapKey(editingGap);
          setCorrectMoveOverrides((current) => ({
            ...current,
            [key]: move,
          }));
          setEditingGap(null);
          notifications.show({
            title: "Training move updated",
            message: `${move.san} will be used when you save or add this row.`,
            color: "green",
          });
        }}
      />
      <OpeningHealthReviewSaveModal
        opened={reviewSaveOpen}
        deckMode={reviewDeckMode}
        deckName={reviewDeckName}
        deckPath={reviewDeckPath}
        decks={reviewDecks ?? []}
        limit={reviewDeckLimit}
        saving={reviewSaving}
        trainableCount={countOpeningHealthReviewPositions(
          visibleRows,
          engineVerifications,
          analysisMode,
          correctMoveOverrides,
        )}
        onClose={() => setReviewSaveOpen(false)}
        onDeckModeChange={setReviewDeckMode}
        onDeckNameChange={setReviewDeckName}
        onDeckPathChange={setReviewDeckPath}
        onLimitChange={setReviewDeckLimit}
        autoUpdate={reviewAutoUpdate}
        autoUpdateAvailable={canAutoUpdateReviewDeck}
        autoUpdateUnavailableReason={reviewAutoUpdateBlockedReason}
        onAutoUpdateChange={setReviewAutoUpdate}
        onSave={saveReviewDeck}
      />
    </>
  );
}

function ColumnHeader({ label, help }: { label: string; help: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text size="sm" fw={700}>
        {label}
      </Text>
      <Tooltip label={help} multiline maw={260} withArrow>
        <ActionIcon aria-label={`${label} help`} size="xs" variant="subtle" color="gray">
          <IconInfoCircle size="0.8rem" />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function OpeningHealthReviewSaveModal({
  opened,
  deckMode,
  deckName,
  deckPath,
  decks,
  limit,
  saving,
  trainableCount,
  onClose,
  onDeckModeChange,
  onDeckNameChange,
  onDeckPathChange,
  onLimitChange,
  autoUpdate,
  autoUpdateAvailable,
  autoUpdateUnavailableReason,
  onAutoUpdateChange,
  onSave,
}: {
  opened: boolean;
  deckMode: "new" | "existing";
  deckName: string;
  deckPath: string | null;
  decks: { path: string; name: string; total: number; due: number; unseen: number }[];
  limit: number;
  saving: boolean;
  trainableCount: number;
  onClose: () => void;
  onDeckModeChange: (mode: "new" | "existing") => void;
  onDeckNameChange: (name: string) => void;
  onDeckPathChange: (path: string | null) => void;
  onLimitChange: (limit: number) => void;
  autoUpdate: boolean;
  autoUpdateAvailable: boolean;
  autoUpdateUnavailableReason: string | null;
  onAutoUpdateChange: (enabled: boolean) => void;
  onSave: () => void;
}) {
  const existingOptions = decks.map((deck) => ({
    value: deck.path,
    label: `${deck.name} (${deck.total} positions${deck.due + deck.unseen > 0 ? `, ${deck.due + deck.unseen} due` : ""})`,
  }));

  return (
    <Modal opened={opened} onClose={onClose} title={<b>Save Opening Review deck</b>} size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Save these flagged positions as spaced-repetition cards. If you update an existing deck,
          matching positions keep their review history.
        </Text>
        <SegmentedControl
          value={deckMode}
          onChange={(value) => onDeckModeChange(value as "new" | "existing")}
          data={[
            { value: "existing", label: "Update existing" },
            { value: "new", label: "New deck" },
          ]}
          disabled={decks.length === 0}
        />
        {deckMode === "new" ? (
          <TextInput
            label="Deck name"
            value={deckName}
            onChange={(event) => onDeckNameChange(event.currentTarget.value)}
            placeholder="Opening Review"
          />
        ) : (
          <Select
            label="Review deck"
            data={existingOptions}
            value={deckPath}
            onChange={onDeckPathChange}
            searchable
            allowDeselect={false}
          />
        )}
        <NumberInput
          label="Initial positions to save"
          description="Saved in the current table order. Use 0 to save every trainable visible row; ongoing deck caps are set in Opening gap settings."
          value={limit}
          min={0}
          max={5000}
          onChange={(value) => onLimitChange(Math.max(0, Math.round(Number(value) || 0)))}
        />
        <Switch
          checked={autoUpdate && autoUpdateAvailable}
          disabled={!autoUpdateAvailable}
          onChange={(event) => onAutoUpdateChange(event.currentTarget.checked)}
          label="Auto-update this review deck"
          description={
            autoUpdateAvailable
              ? "When this online games database imports new games, scan it again and merge fresh gaps into this deck."
              : autoUpdateUnavailableReason
          }
        />
        <Alert color="blue" variant="light">
          {trainableCount} visible position{trainableCount === 1 ? "" : "s"} have a clear move to
          train.
        </Alert>
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size="1rem" />}
            loading={saving}
            onClick={onSave}
            disabled={
              trainableCount === 0 ||
              (deckMode === "new" ? deckName.trim().length === 0 : !deckPath)
            }
          >
            Save deck
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function OpeningHealthMoveEditModal({
  gap,
  currentMove,
  onClose,
  onSave,
}: {
  gap: RepertoireGap | null;
  currentMove: OpeningHealthTrainingMove | null;
  onClose: () => void;
  onSave: (move: OpeningHealthTrainingMove) => void;
}) {
  const [moveInput, setMoveInput] = useState("");

  useEffect(() => {
    setMoveInput(currentMove?.san ?? "");
  }, [currentMove, gap]);

  const saveMove = () => {
    if (!gap) return;
    const move = parseOpeningHealthCorrectMove(gap, moveInput);
    if (!move) {
      notifications.show({
        title: "Move not recognised",
        message: "Type a legal move from this position, for example Nf3 or g1f3.",
        color: "red",
      });
      return;
    }
    onSave(move);
  };

  return (
    <Modal opened={Boolean(gap)} onClose={onClose} title={<b>Edit training move</b>} size="sm">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          This is the move saved to training or to an Opening Review deck for this row.
        </Text>
        <TextInput
          label="Move to train"
          value={moveInput}
          onChange={(event) => setMoveInput(event.currentTarget.value)}
          placeholder="Nf3"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              saveMove();
            }
          }}
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={saveMove} disabled={!moveInput.trim()}>
            Save move
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function countOpeningHealthReviewPositions(
  rows: RepertoireGap[],
  verifications: Record<string, EngineVerification>,
  mode: OpeningHealthMode,
  overrides: Record<string, OpeningHealthTrainingMove> = {},
) {
  return rows.filter(
    (gap) => overrides[gapKey(gap)] || getOpeningHealthTrainingMove(gap, verifications[gapKey(gap)], mode),
  ).length;
}

function createOpeningReviewAutoUpdateConfig({
  record,
  playerDb,
  playerId,
  playerName,
  referenceDb,
  mode,
  maxPlies,
  minPlayerGames,
  minReferenceGames,
  dateBounds,
}: {
  record: NonNullable<ReturnType<typeof getOnlineDatabaseUpdateRecord>>;
  playerDb: string;
  playerId: number | null;
  playerName: string | null;
  referenceDb: string;
  mode: OpeningHealthMode;
  maxPlies: number;
  minPlayerGames: number;
  minReferenceGames: number;
  dateBounds: OpeningHealthDateBounds;
}): OpeningReviewAutoUpdateConfig {
  const now = Date.now();
  return {
    enabled: true,
    playerDb,
    playerId,
    playerName,
    referenceDb,
    mode,
    color: "any",
    maxPlies,
    minPlayerGames,
    minReferenceGames,
    topReferenceMoves: DEFAULT_TOP_REFERENCE_MOVES,
    dateRange: dateBounds.range,
    startDate: dateBounds.startDate,
    endDate: dateBounds.endDate,
    maxPositions: 0,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastUpdatedDatabaseAt: record.lastUpdatedAt,
    lastKnownGameCount: record.lastKnownGameCount,
    lastAdded: null,
    lastError: null,
  };
}

function createOpeningHealthReviewPosition(
  gap: RepertoireGap,
  verification: EngineVerification | undefined,
  mode: OpeningHealthMode,
  override?: OpeningHealthTrainingMove,
  dateBounds?: OpeningHealthDateBounds,
) {
  const trainingMove = override ?? getOpeningHealthTrainingMove(gap, verification, mode);
  if (!trainingMove) return null;

  const priority = openingHealthPriority(gap, verification, mode);
  const strongMoveResult = gap.topReferenceMoves.find((move) => move.uci === gap.playerMoveUci);
  const topMove = gap.topReferenceMoves[0];
  return createOpeningHealthTrainingItem(gap, trainingMove, {
    priority: openingHealthUrgency(gap, verification),
    importedAt: Date.now(),
    reason: getOpeningHealthReviewReason(gap, verification, mode, priority.description),
    evidence: `${formatNumber(gap.playerPositionGames)} games; ${formatLastPlayed(
      gap.lastPlayed,
    )}; result ${formatPercent(gap.playerScore)}`,
    engine:
      verification && verification.status !== "missing"
        ? {
            source: verification.source,
            lossCp: verification.lossCp,
            depth: verification.depth,
            bestMoveSan: verification.bestMoveSan,
            bestMoveUci: verification.bestMoveUci,
          }
        : undefined,
    openingHealth: {
      mode,
      sideToMove: gap.sideToMove === "black" ? "black" : "white",
      usualMoveSan: gap.playerMoveSan,
      usualMoveUci: gap.playerMoveUci,
      games: gap.playerPositionGames,
      white: gap.playerWhite,
      draw: gap.playerDraw,
      black: gap.playerBlack,
      score: gap.playerScore,
      strongGames: gap.referenceGames,
      strongWhite: strongMoveResult?.white ?? null,
      strongDraw: strongMoveResult?.draw ?? null,
      strongBlack: strongMoveResult?.black ?? null,
      strongScore: strongMoveResult?.scoreForSide ?? gap.referenceScore,
      topMoveSan: topMove?.san ?? null,
      topMoveUci: topMove?.uci ?? null,
      lastPlayed: gap.lastPlayed,
      dateRange: dateBounds?.range,
      startDate: dateBounds?.startDate,
      endDate: dateBounds?.endDate,
    },
  });
}

function getOpeningHealthTrainingMove(
  gap: RepertoireGap,
  verification: EngineVerification | undefined,
  mode: OpeningHealthMode,
) {
  if (
    verification?.bestMoveUci &&
    verification.bestMoveUci !== gap.playerMoveUci &&
    verification.status !== "ok" &&
    verification.status !== "missing"
  ) {
    const move = getOpeningHealthMoveFromUci(
      gap,
      verification.bestMoveUci,
      verification.bestMoveSan ?? "Engine move",
    );
    if (move) return { san: move.san, uci: verification.bestMoveUci };
  }

  const differentSuggestedMove =
    gap.topReferenceMoves.find((move) => move.uci !== gap.playerMoveUci) ?? null;
  const engineSuggestedMove = verification?.bestMoveUci
    ? (gap.topReferenceMoves.find(
        (move) => move.uci === verification.bestMoveUci && move.uci !== gap.playerMoveUci,
      ) ?? null)
    : null;
  const nextStep = openingHealthNextStep(
    gap,
    differentSuggestedMove,
    engineSuggestedMove,
    verification,
    mode,
  );

  if (nextStep.trainingMove) {
    return {
      san: nextStep.trainingMove.san,
      uci: nextStep.trainingMove.uci,
    };
  }

  if (gap.classification === "preparedUnderperforming") {
    return {
      san: gap.playerMoveSan,
      uci: gap.playerMoveUci,
    };
  }

  return null;
}

function getOpeningHealthReviewReason(
  gap: RepertoireGap,
  verification: EngineVerification | undefined,
  mode: OpeningHealthMode,
  fallback: string,
) {
  if (verification?.status === "bad" || verification?.status === "questionable") {
    const source = verificationSourceLabel(verification);
    const bestMove = verification.bestMoveSan ? ` ${verification.bestMoveSan}` : " another move";
    return `${source} flags ${gap.playerMoveSan}: it prefers${bestMove} by about ${Math.round(
      verification.lossCp,
    )} cp.`;
  }

  return getOpeningReviewGapReason(gap, mode) || fallback;
}

function getOpeningHealthModeCopy(mode: OpeningHealthMode) {
  if (mode === "self") {
    return {
      description: "Find opening lines where your usual choices or results need attention.",
      personalDatabaseLabel: "My games database",
      subjectPlayerLabel: "My player",
      minimumGamesLabel: "Minimum my games",
      databaseMissingText: "your games database",
      gamesBadge: "my games",
      flaggedBadge: "gaps",
      emptyText:
        "Choose your games database and a strong-games source, then run a scan. Rows show lines where your move choice or results may need work.",
      playedColumnLabel: "I played",
      nextStepColumnLabel: "Next step",
      priorityHelp:
        "Rows are sorted by urgency. Your result in the line matters most, then frequency and recency. Engine scores stay light unless the move drops more than half a pawn.",
      lineHelp: "The moves that lead to the position. Click any row to load it on the board.",
      playedHelp: "The move you most often played in this position.",
      nextStepHelp:
        "For different-move rows, this shows a stronger move to learn. For bad-result rows where you already played the main move, review the follow-up instead.",
      evidenceHelp: "How often this position appeared in your games and in strong games.",
      resultHelp:
        "White/draw/black win rates for your games, plus the same view for strong games when that move is covered.",
      saveHelp: "Add this move to training, edit the move to train, or hide a row you do not want.",
    };
  }

  return {
    description: "Scout an opponent and find lines where they choose odd moves or score poorly.",
    personalDatabaseLabel: "Opponent games database",
    subjectPlayerLabel: "Opponent player",
    minimumGamesLabel: "Minimum opponent games",
    databaseMissingText: "an opponent games database",
    gamesBadge: "opponent games",
    flaggedBadge: "prep ideas",
    emptyText:
      "Choose the opponent's games and a strong-games source, then run a scan. Rows show lines you may want to aim for in prep.",
    playedColumnLabel: "They played",
    nextStepColumnLabel: "Next step",
    priorityHelp:
      "Rows are sorted by urgency. Their result in the line matters most, then frequency and recency. Engine scores stay light unless the move drops more than half a pawn.",
    lineHelp: "The moves that lead to the position. Click any row to load it on the board.",
    playedHelp: "The move this opponent most often played in this position.",
    nextStepHelp:
      "For unusual-move rows, this shows a strong move to aim for. For bad-result rows where they already played the main move, review the follow-up instead.",
    evidenceHelp: "How often this position appeared in their games and in strong games.",
    resultHelp:
      "White/draw/black win rates for the opponent's games, plus the same view for strong games when that move is covered.",
    saveHelp: "Add this move to training, edit the move to train, or hide a row you do not want.",
  };
}

function getOpeningHealthTimingText(
  startedAt: number | null,
  completedAt: number | null,
  now: number,
  progress: OpeningHealthProgress | null,
  loading: boolean,
  samples: OpeningHealthProgressSample[],
) {
  if (!startedAt) return null;

  if (!loading && completedAt) {
    return `Completed in ${formatDuration(completedAt - startedAt)}`;
  }

  if (!loading) return null;
  if (isOpeningHealthFinalizing(progress)) return "Finalizing";
  if (progress?.phase === "Paused") return "Paused";

  const elapsed = Math.max(0, now - startedAt);
  const boundedProgress = Math.min(99, Math.max(0, progress?.progress ?? 0));
  if (elapsed < 5000 || boundedProgress < 2) {
    return "ETA estimating";
  }

  const phaseSamples = samples.filter(
    (sample) => sample.phase === progress?.phase && !sample.finished,
  );
  const latest = phaseSamples[phaseSamples.length - 1];
  if (!latest) return "ETA estimating";

  const baseline =
    phaseSamples.find(
      (sample) => latest.time - sample.time >= 3000 && latest.progress - sample.progress >= 0.5,
    ) ?? phaseSamples[0];
  if (!baseline) return "ETA estimating";

  const elapsedInPhase = latest.time - baseline.time;
  const progressInPhase = latest.progress - baseline.progress;
  if (elapsedInPhase < 3000 || progressInPhase <= 0) {
    return "ETA estimating";
  }

  const progressPerMillisecond = progressInPhase / elapsedInPhase;
  const remaining = (100 - boundedProgress) / progressPerMillisecond;
  return `ETA ${formatDuration(remaining)}`;
}

function isOpeningHealthFinalizing(progress: OpeningHealthProgress | null | undefined) {
  return Boolean(progress?.finished || progress?.phase === "Finalizing report");
}

function getOpeningHealthPlayerSearchSeed(database: SuccessDatabaseInfo | null) {
  const rawName = database?.title || database?.filename || "";
  const baseName = rawName
    .replace(/\.db3$/i, "")
    .replace(/[_\s-]*(lichess|chess\.com|chesscom)$/i, "")
    .replace(/[_\s-]*(games|database)$/i, "")
    .trim();
  return baseName || "";
}

function normalizeOpeningHealthPlayerName(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function getOnlineReferenceSource(value: string | null): OnlineReferenceSource | null {
  if (value === LICHESS_ALL_SOURCE || value === LICHESS_MASTER_SOURCE) return value;
  return null;
}

async function analyzeOnlineReference({
  id,
  personalDb,
  playerId,
  source,
  explorerToken,
  lichessOptions,
  masterOptions,
  maxPlies,
  colorFilter,
  minPersonalGames,
  minReferenceGames,
  dateBounds,
  setProgress,
  getControlState,
}: {
  id: string;
  personalDb: string;
  playerId: number;
  source: OnlineReferenceSource;
  explorerToken: string;
  lichessOptions: LichessGamesOptions;
  masterOptions: MasterGamesOptions;
  maxPlies: number;
  colorFilter: OpeningHealthColorFilter;
  minPersonalGames: number;
  minReferenceGames: number;
  dateBounds: OpeningHealthDateBounds;
  setProgress: (progress: OpeningHealthProgress) => void;
  getControlState: () => { paused: boolean; stopRequested: boolean };
}): Promise<{ status: "ok"; data: RepertoireGapReport } | { status: "error"; error: string }> {
  const playerResult = await commands.getOpeningHealthPlayerPositions({
    playerDb: personalDb,
    playerId,
    color: colorFilter,
    maxPlies,
    startDate: dateBounds.startDate,
    endDate: dateBounds.endDate,
    requestId: id,
  });

  if (playerResult.status === "error") return playerResult;

  const playerReport = playerResult.data;
  const candidatePositions = playerReport.positions
    .filter((position) => position.playerPositionGames >= minPersonalGames)
    .slice(0, ONLINE_REFERENCE_POSITION_LIMIT);
  const gaps: RepertoireGap[] = [];
  let referencePositions = 0;
  let processed = 0;
  let cursor = 0;

  setProgress({
    id,
    progress: 50,
    gamesScanned: playerReport.playerGames,
    positionsProcessed: candidatePositions.length,
    phase: "Checking strong games",
    finished: false,
  });

  async function next() {
    while (cursor < candidatePositions.length) {
      const waitResult = await waitForOpeningHealthResume(getControlState);
      if (waitResult === "stopped") {
        return;
      }

      const index = cursor;
      cursor += 1;
      const playerPosition = candidatePositions[index];
      if (!playerPosition) continue;
      const reference = await getOnlineReferenceData(
        playerPosition.fen,
        source,
        explorerToken,
        lichessOptions,
        masterOptions,
      );
      const gap = buildOnlineGap(playerPosition, reference, minPersonalGames, minReferenceGames);

      if (reference.white + reference.draws + reference.black > 0) {
        referencePositions += 1;
      }
      if (gap) gaps.push(gap);

      processed += 1;
      setProgress({
        id,
        progress: 50 + Math.min(48, (processed / Math.max(1, candidatePositions.length)) * 48),
        gamesScanned: playerReport.playerGames,
        positionsProcessed: processed,
        phase: "Checking strong games",
        finished: false,
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ONLINE_REFERENCE_CONCURRENCY, candidatePositions.length) }, next),
  );

  if (getControlState().stopRequested) {
    return { status: "error", error: "Search stopped" };
  }

  gaps.sort((a, b) => {
    return (
      b.severity - a.severity || b.playerPositionGames - a.playerPositionGames || a.ply - b.ply
    );
  });
  gaps.length = Math.min(gaps.length, OPENING_HEALTH_MAX_REPORT_ROWS);

  const report = {
    playerGames: playerReport.playerGames,
    candidatePositions: candidatePositions.length,
    referencePositions,
    gaps,
  };

  setProgress({
    id,
    progress: 99,
    gamesScanned: playerReport.playerGames,
    positionsProcessed: candidatePositions.length,
    phase: "Finalizing report",
    finished: false,
  });

  return { status: "ok", data: report };
}

async function getOnlineReferenceData(
  fen: string,
  source: OnlineReferenceSource,
  explorerToken: string,
  lichessOptions: LichessGamesOptions,
  masterOptions: MasterGamesOptions,
) {
  if (source === LICHESS_ALL_SOURCE) {
    return await getLichessGames(
      fen,
      { ...lichessOptions, moves: Math.max(DEFAULT_TOP_REFERENCE_MOVES, 5) },
      explorerToken,
    );
  }

  return await getMasterGames(
    fen,
    { ...masterOptions, moves: Math.max(DEFAULT_TOP_REFERENCE_MOVES, 5) },
    explorerToken,
  );
}

async function waitForOpeningHealthResume(
  getControlState: () => { paused: boolean; stopRequested: boolean },
) {
  while (getControlState().paused && !getControlState().stopRequested) {
    await delay(150);
  }
  return getControlState().stopRequested ? "stopped" : "running";
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function buildOnlineGap(
  playerPosition: OpeningHealthPlayerPosition,
  reference: PositionData,
  minPersonalGames: number,
  minReferenceGames: number,
): RepertoireGap | null {
  const referenceGames = reference.white + reference.draws + reference.black;
  const sideToMove = playerPosition.sideToMove === "black" ? "black" : "white";
  const referenceMoves = reference.moves
    .map<RepertoireGapReferenceMove>((move) => ({
      san: move.san,
      uci: move.uci,
      games: move.white + move.draws + move.black,
      white: move.white,
      draw: move.draws,
      black: move.black,
      share: referenceGames > 0 ? (move.white + move.draws + move.black) / referenceGames : 0,
      scoreForSide: scoreForSide(move.white, move.draws, move.black, sideToMove),
    }))
    .sort(
      (a, b) => b.games - a.games || b.scoreForSide - a.scoreForSide || a.san.localeCompare(b.san),
    );
  const referenceMoveIndex = referenceMoves.findIndex(
    (move) => move.uci === playerPosition.playerMoveUci,
  );
  const referenceMoveRank = referenceMoveIndex >= 0 ? referenceMoveIndex + 1 : null;
  const referenceMoveShare =
    referenceMoveIndex >= 0 ? (referenceMoves[referenceMoveIndex]?.share ?? 0) : 0;
  const topReferenceMoveScore = referenceMoves[0]?.scoreForSide ?? null;
  const referenceScore =
    referenceMoveIndex >= 0
      ? (referenceMoves[referenceMoveIndex]?.scoreForSide ?? topReferenceMoveScore)
      : topReferenceMoveScore;
  const classification = classifyOnlineOpeningHealth(
    playerPosition.playerPositionGames,
    referenceGames,
    referenceMoveRank,
    playerPosition.playerScore,
    referenceScore,
    minPersonalGames,
    minReferenceGames,
  );

  if (!classification) return null;

  const bestReferenceShare = referenceMoves[0]?.share ?? 0;
  const popularityGap = Math.max(0, bestReferenceShare - referenceMoveShare);
  const scoreGap = Math.max(0, (referenceScore ?? 0) - playerPosition.playerScore);

  return {
    fen: playerPosition.fen,
    normalizedFen: playerPosition.normalizedFen,
    ply: playerPosition.ply,
    sideToMove: playerPosition.sideToMove,
    moveSequence: playerPosition.moveSequence,
    playerMoveSan: playerPosition.playerMoveSan,
    playerMoveUci: playerPosition.playerMoveUci,
    playerGames: playerPosition.playerGames,
    playerPositionGames: playerPosition.playerPositionGames,
    playerWhite: playerPosition.playerWhite,
    playerDraw: playerPosition.playerDraw,
    playerBlack: playerPosition.playerBlack,
    playerScore: playerPosition.playerScore,
    lastPlayed: playerPosition.lastPlayed,
    referenceGames,
    referenceMoveRank,
    referenceMoveShare,
    referenceScore,
    topReferenceMoveScore,
    classification,
    popularityGap,
    scoreGap,
    severity: openingHealthSeverity(
      classification,
      playerPosition.playerPositionGames,
      popularityGap,
      scoreGap,
    ),
    sampleGameIds: playerPosition.sampleGameIds,
    topReferenceMoves: referenceMoves.slice(0, Math.max(DEFAULT_TOP_REFERENCE_MOVES, 5)),
  };
}

function classifyOnlineOpeningHealth(
  playerPositionGames: number,
  referenceGames: number,
  referenceMoveRank: number | null,
  playerScore: number,
  referenceScore: number | null,
  minPersonalGames: number,
  minReferenceGames: number,
): RepertoireGap["classification"] | null {
  if (playerPositionGames < minPersonalGames || referenceGames < minReferenceGames) {
    return null;
  }

  if (!referenceMoveRank || referenceMoveRank > DEFAULT_TOP_REFERENCE_MOVES) {
    return "repertoireGap";
  }

  const scoreGap = (referenceScore ?? 0) - playerScore;
  if (scoreGap >= OPENING_HEALTH_SCORE_GAP && playerScore <= OPENING_HEALTH_POOR_SCORE) {
    return "preparedUnderperforming";
  }

  return null;
}

function openingHealthSeverity(
  classification: RepertoireGap["classification"],
  playerPositionGames: number,
  popularityGap: number,
  scoreGap: number,
) {
  const sampleWeight = Math.log1p(playerPositionGames) * 4;
  if (classification === "repertoireGap") {
    return clamp(45 + popularityGap * 45 + sampleWeight, 0, 100);
  }
  if (classification === "preparedUnderperforming") {
    return clamp(40 + Math.max(0, scoreGap) * 120 + sampleWeight, 0, 100);
  }
  return clamp(10 + sampleWeight, 0, 35);
}

function scoreForSide(white: number, draw: number, black: number, side: "white" | "black") {
  const total = white + draw + black;
  if (total <= 0) return 0;
  const score = side === "white" ? white + draw * 0.5 : black + draw * 0.5;
  return score / total;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getOpeningHealthLineMoves(gap: RepertoireGap) {
  const [pos] = positionFromFen(INITIAL_FEN);
  if (!pos) return [];

  const moves: OpeningHealthMovePreview[] = [];
  for (const san of getOpeningHealthMoveTokens(gap.moveSequence)) {
    const move = parseSan(pos, san);
    if (!move || !pos.isLegal(move)) break;

    const preview = buildOpeningHealthMovePreview(pos, move, san);
    if (!preview) break;
    moves.push(preview);
  }

  return moves;
}

function getOpeningHealthMoveFromUci(
  gap: RepertoireGap,
  moveUci: string | null,
  fallbackSan: string,
) {
  if (!moveUci) return null;

  const [pos] = positionFromFen(gap.fen);
  const move = parseUci(moveUci);
  if (!pos || !move || !pos.isLegal(move)) return null;

  return buildOpeningHealthMovePreview(pos, move, fallbackSan);
}

function parseOpeningHealthCorrectMove(
  gap: RepertoireGap,
  value: string,
): OpeningHealthTrainingMove | null {
  const input = value.trim();
  if (!input) return null;

  const [pos] = positionFromFen(gap.fen);
  if (!pos) return null;

  let move: Move | undefined | null = parseSan(pos, input);
  if (!move) {
    const uciMove = parseUci(input);
    if (uciMove && pos.isLegal(uciMove)) {
      move = uciMove;
    }
  }
  if (!move || !pos.isLegal(move)) return null;

  return {
    san: makeSan(pos, move),
    uci: makeUci(move),
  };
}

function buildOpeningHealthMovePreview(
  pos: Chess,
  move: Move,
  fallbackSan: string,
): OpeningHealthMovePreview | null {
  const [orig, dest] = chessgroundMove(move);
  if (!orig || !dest) return null;

  const beforeFen = makeFen(pos.toSetup());
  const san = safeMakeSan(pos, move, fallbackSan);
  const uci = makeUci(move);
  pos.play(move);

  return {
    san,
    beforeFen,
    afterFen: makeFen(pos.toSetup()),
    uci,
    orig,
    dest,
  };
}

function getOpeningHealthMoveTokens(sequence: string) {
  return sequence
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((token) =>
      token
        .replace(/^\d+\.(\.\.)?/, "")
        .replace(/[!?]+$/g, "")
        .trim(),
    )
    .filter(
      (token) =>
        token &&
        !/^\d+\.*$/.test(token) &&
        !/^\$\d+$/.test(token) &&
        token !== "*" &&
        token !== "1-0" &&
        token !== "0-1" &&
        token !== "1/2-1/2",
    );
}

function safeMakeSan(pos: Chess, move: Move, fallbackSan: string) {
  try {
    return makeSan(pos, move);
  } catch {
    return fallbackSan;
  }
}

function OpeningHealthRow({
  gap,
  mode,
  verification,
  correctMoveOverride,
  onLoad,
  onPreview,
  onClearPreview,
  onAddTraining,
  onEditMove,
  onDismiss,
}: {
  gap: RepertoireGap;
  mode: OpeningHealthMode;
  verification?: EngineVerification;
  correctMoveOverride?: OpeningHealthTrainingMove;
  onLoad: (fen?: string) => void;
  onPreview: (preview: OpeningHealthPreviewPayload | null) => void;
  onClearPreview: () => void;
  onAddTraining: (suggestedMove: OpeningHealthTrainingMove) => void;
  onEditMove: () => void;
  onDismiss: () => void;
}) {
  const differentSuggestedMove =
    gap.topReferenceMoves.find((move) => move.uci !== gap.playerMoveUci) ?? null;
  const engineSuggestedMove = verification?.bestMoveUci
    ? (gap.topReferenceMoves.find(
        (move) => move.uci === verification.bestMoveUci && move.uci !== gap.playerMoveUci,
      ) ?? null)
    : null;
  const nextStep = openingHealthNextStep(
    gap,
    differentSuggestedMove,
    engineSuggestedMove,
    verification,
    mode,
  );
  const priority = openingHealthPriority(gap, verification, mode);
  const sideToMove = gap.sideToMove === "black" ? "black" : "white";
  const rankText = gap.referenceMoveRank
    ? `#${gap.referenceMoveRank} in strong games`
    : "Rare in strong games";
  const moveSequence = gap.moveSequence || "Starting position";
  const lineMoves = useMemo(() => getOpeningHealthLineMoves(gap), [gap]);
  const playedMove = useMemo(
    () => getOpeningHealthMoveFromUci(gap, gap.playerMoveUci, gap.playerMoveSan),
    [gap],
  );
  const resultLabel = mode === "self" ? "My games" : "Opponent games";
  const strongMoveResult = gap.topReferenceMoves.find((move) => move.uci === gap.playerMoveUci);
  const trainingMove =
    correctMoveOverride ?? getOpeningHealthTrainingMove(gap, verification, mode);
  const nextStepTitle = correctMoveOverride?.san ?? nextStep.title;
  const nextStepDetail = correctMoveOverride ? "Chosen by you for training" : nextStep.detail;
  const verificationLabel =
    verification && verification.status !== "missing"
      ? `${verificationSourceLabel(verification)}${verification.depth ? ` depth ${verification.depth}` : ""}`
      : null;

  return (
    <Table.Tr
      onClick={() => onLoad()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onLoad();
        }
      }}
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
    >
      <Table.Td>
        <Stack gap={4}>
          <Badge color={priority.color} variant="light" w="fit-content">
            {priority.label}
          </Badge>
          <Text size="xs" c="dimmed">
            {priority.description}
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        <Stack gap={3}>
          <OpeningHealthMoveLine
            fallbackText={moveSequence}
            moves={lineMoves}
            onLoad={onLoad}
            onPreview={onPreview}
            onClearPreview={onClearPreview}
          />
          <Text size="xs" c="dimmed">
            Ply {gap.ply + 1}, {gap.sideToMove} to move
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        <Stack gap={2}>
          <OpeningHealthMoveChip
            move={playedMove}
            fallback={gap.playerMoveSan}
            fw={700}
            onLoad={onLoad}
            onPreview={onPreview}
            onClearPreview={onClearPreview}
          />
          <Text size="xs" c="dimmed">
            {rankText}
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        <Stack gap={2}>
          <OpeningHealthSuggestedMove
            gap={gap}
            title={nextStepTitle}
            moveUci={trainingMove?.uci ?? nextStep.trainingMove?.uci ?? verification?.bestMoveUci ?? null}
            fw={700}
            onLoad={onLoad}
            onPreview={onPreview}
            onClearPreview={onClearPreview}
          />
          <Text size="xs" c="dimmed">
            {nextStepDetail}
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        <Stack gap={2}>
          <Text size="sm">{formatNumber(gap.playerPositionGames)} games</Text>
          <Text size="xs" c="dimmed">
            {formatNumber(gap.referenceGames)} strong games
          </Text>
          <Text size="xs" c="dimmed">
            {formatLastPlayed(gap.lastPlayed)}
          </Text>
          {verificationLabel && (
            <Text size="xs" c="dimmed">
              {verificationLabel}
            </Text>
          )}
        </Stack>
      </Table.Td>
      <Table.Td>
        <OpeningHealthResultBars
          label={resultLabel}
          white={gap.playerWhite}
          draw={gap.playerDraw}
          black={gap.playerBlack}
          score={gap.playerScore}
          side={sideToMove}
        />
        {strongMoveResult ? (
          <OpeningHealthResultBars
            label="Strong games"
            white={strongMoveResult.white}
            draw={strongMoveResult.draw}
            black={strongMoveResult.black}
            score={strongMoveResult.scoreForSide}
            side={sideToMove}
          />
        ) : (
          <Text size="xs" c="dimmed" mt={4}>
            Strong games {gap.referenceScore === null ? "-" : formatPercent(gap.referenceScore)}
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Add suggested move to training">
            <ActionIcon
              aria-label="Add suggested move to training"
              size="sm"
              variant="light"
              onClick={(event) => {
                event.stopPropagation();
                if (trainingMove) {
                  onAddTraining(trainingMove);
                }
              }}
              disabled={!trainingMove}
            >
              <IconPlus size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Edit training move">
            <ActionIcon
              aria-label="Edit training move"
              size="sm"
              variant="subtle"
              onClick={(event) => {
                event.stopPropagation();
                onEditMove();
              }}
            >
              <IconPencil size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Hide this result">
            <ActionIcon
              aria-label="Hide this result"
              size="sm"
              variant="subtle"
              color="red"
              onClick={(event) => {
                event.stopPropagation();
                onDismiss();
              }}
            >
              <IconTrash size="1rem" />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

function OpeningHealthMoveLine({
  fallbackText,
  moves,
  onLoad,
  onPreview,
  onClearPreview,
}: {
  fallbackText: string;
  moves: OpeningHealthMovePreview[];
  onLoad: (fen?: string) => void;
  onPreview: (preview: OpeningHealthPreviewPayload | null) => void;
  onClearPreview: () => void;
}) {
  if (moves.length === 0) {
    return (
      <Text size="sm" lineClamp={2}>
        {fallbackText}
      </Text>
    );
  }

  return (
    <Group gap={4} maw={360}>
      {moves.map((move, index) => (
        <OpeningHealthMoveChip
          key={`${move.uci}-${index}`}
          move={move}
          fallback={move.san}
          onLoad={onLoad}
          onPreview={onPreview}
          onClearPreview={onClearPreview}
        />
      ))}
    </Group>
  );
}

function OpeningHealthSuggestedMove({
  gap,
  title,
  moveUci,
  fw,
  onLoad,
  onPreview,
  onClearPreview,
}: {
  gap: RepertoireGap;
  title: string;
  moveUci: string | null;
  fw?: number;
  onLoad: (fen?: string) => void;
  onPreview: (preview: OpeningHealthPreviewPayload | null) => void;
  onClearPreview: () => void;
}) {
  const move = useMemo(
    () => getOpeningHealthMoveFromUci(gap, moveUci, title),
    [gap, moveUci, title],
  );
  return (
    <OpeningHealthMoveChip
      move={move}
      fallback={title}
      fw={fw}
      onLoad={onLoad}
      onPreview={onPreview}
      onClearPreview={onClearPreview}
    />
  );
}

function OpeningHealthMoveChip({
  move,
  fallback,
  fw,
  onLoad,
  onPreview,
  onClearPreview,
}: {
  move: OpeningHealthMovePreview | null;
  fallback: string;
  fw?: number;
  onLoad: (fen?: string) => void;
  onPreview: (preview: OpeningHealthPreviewPayload | null) => void;
  onClearPreview: () => void;
}) {
  const text = move?.san ?? fallback;

  const showPreview = () => {
    if (!move) return;
    onPreview({
      fen: move.afterFen,
      displayFen: move.afterFen,
      shapes: [
        {
          orig: move.orig,
          dest: move.dest,
          brush: "preview",
          modifiers: {
            lineWidth: 10,
          },
        },
      ],
    });
  };

  const hidePreview = () => {
    onClearPreview();
  };

  if (!move) {
    return (
      <Text size="sm" fw={fw}>
        {text}
      </Text>
    );
  }

  return (
    <Box
      component="button"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        hidePreview();
        onLoad(move.afterFen);
      }}
      onMouseEnter={showPreview}
      onMouseLeave={hidePreview}
      onFocus={showPreview}
      onBlur={hidePreview}
      style={{
        backgroundColor: "transparent",
        border: 0,
        color: "inherit",
        cursor: "pointer",
        display: "inline-flex",
        font: "inherit",
        fontWeight: fw,
        lineHeight: 1.35,
        outline: "none",
        padding: 0,
      }}
      title="Show this move on the board"
    >
      {text}
    </Box>
  );
}

function OpeningHealthResultBars({
  label,
  white,
  draw,
  black,
  score,
  side,
}: {
  label: string;
  white: number;
  draw: number;
  black: number;
  score: number;
  side: "white" | "black";
}) {
  const total = white + draw + black;
  const whitePercent = total > 0 ? (white / total) * 100 : 0;
  const drawPercent = total > 0 ? (draw / total) * 100 : 0;
  const blackPercent = total > 0 ? (black / total) * 100 : 0;
  const scoreLabel = `${side === "white" ? "White" : "Black"} score ${formatPercent(score)}`;

  return (
    <Stack gap={3} mb={6}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text size="xs" fw={700}>
          {scoreLabel}
        </Text>
      </Group>
      <Tooltip
        withArrow
        label={`White ${whitePercent.toFixed(1)}% / Draw ${drawPercent.toFixed(
          1,
        )}% / Black ${blackPercent.toFixed(1)}%`}
      >
        <Progress.Root size="lg" className={resultClasses.result}>
          <Progress.Section value={whitePercent} className={resultClasses.whiteResultsSection}>
            <Progress.Label c="black">
              {whitePercent > 18 ? `${whitePercent.toFixed(0)}%` : ""}
            </Progress.Label>
          </Progress.Section>
          <Progress.Section value={drawPercent} color="gray">
            <Progress.Label>{drawPercent > 18 ? `${drawPercent.toFixed(0)}%` : ""}</Progress.Label>
          </Progress.Section>
          <Progress.Section value={blackPercent} color="black">
            <Progress.Label>
              {blackPercent > 18 ? `${blackPercent.toFixed(0)}%` : ""}
            </Progress.Label>
          </Progress.Section>
        </Progress.Root>
      </Tooltip>
    </Stack>
  );
}

function openingHealthPriority(
  gap: RepertoireGap,
  verification: EngineVerification | undefined,
  mode: OpeningHealthMode,
) {
  const ownerPossessive = mode === "self" ? "Your" : "Their";
  if (verification?.status === "missing") {
    return {
      label: "Cloud missing",
      color: "gray",
      description:
        "No usable Lichess Cloud or ChessDB score was found; priority comes from results and frequency.",
    };
  }
  if (verification?.status === "bad") {
    const source = verificationSourceLabel(verification);
    const depthText = verification.depth ? ` at depth ${verification.depth}` : "";
    return {
      label: "Bad move",
      color: "red",
      description: `${source}${depthText} prefers ${verification.bestMoveSan ?? "another move"} by about ${Math.round(verification.lossCp)} cp.`,
    };
  }
  if (verification?.status === "questionable") {
    const source = verificationSourceLabel(verification);
    const depthText = verification.depth ? ` at depth ${verification.depth}` : "";
    return {
      label: "Engine concern",
      color: "orange",
      description: `${source}${depthText} shows about ${Math.round(verification.lossCp)} cp of drift from the best move.`,
    };
  }
  if (verification?.status === "ok") {
    const source = verificationSourceLabel(verification);
    const depthText = verification.depth ? ` depth ${verification.depth}` : "";
    return {
      label: "Practical issue",
      color: "yellow",
      description: `${source}${depthText} says the move is playable; the flag comes from score, frequency, and recency.`,
    };
  }

  switch (gap.classification) {
    case "repertoireGap":
      return {
        label: "Rare move",
        color: "orange",
        description: `${ownerPossessive} move is unusual in strong games and comes up enough to matter.`,
      };
    case "preparedUnderperforming":
      return {
        label: "Good move, bad score",
        color: "orange",
        description: `${ownerPossessive} move is normal, but the score here is ${formatPercent(gap.playerScore)}; study the plans after it.`,
      };
    case "lowConfidence":
      return {
        label: "Needs data",
        color: classificationColor(gap.classification),
        description: "There are not enough games to trust this yet.",
      };
  }
}

function openingHealthNextStep(
  gap: RepertoireGap,
  differentSuggestedMove: RepertoireGapReferenceMove | null,
  engineSuggestedMove: RepertoireGapReferenceMove | null,
  verification: EngineVerification | undefined,
  mode: OpeningHealthMode,
) {
  if (
    verification &&
    verification.status !== "ok" &&
    verification.bestMoveUci &&
    verification.bestMoveUci !== gap.playerMoveUci
  ) {
    const source = verificationSourceLabel(verification);
    const depthText = verification.depth ? ` at depth ${verification.depth}` : "";
    return {
      title: verification.bestMoveSan ?? engineSuggestedMove?.san ?? "Engine move",
      detail: `${source}${depthText} prefers this by about ${Math.round(verification.lossCp)} cp`,
      trainingMove: engineSuggestedMove,
    };
  }

  if (gap.classification === "repertoireGap" && differentSuggestedMove) {
    return {
      title: differentSuggestedMove.san,
      detail: `Common in ${formatPercent(differentSuggestedMove.share)} of strong games`,
      trainingMove: differentSuggestedMove,
    };
  }

  if (gap.classification === "preparedUnderperforming") {
    return {
      title: gap.playerMoveSan,
      detail:
        mode === "self"
          ? "Good move, bad results: study the plans after it."
          : "Normal move, bad results: prepare the follow-up plans.",
      trainingMove: {
        san: gap.playerMoveSan,
        uci: gap.playerMoveUci,
        games: gap.playerPositionGames,
        white: gap.playerWhite,
        draw: gap.playerDraw,
        black: gap.playerBlack,
        share: 0,
        scoreForSide: gap.playerScore,
      },
    };
  }

  return {
    title: "No clear move",
    detail: "There is not a different suggested move here.",
    trainingMove: null,
  };
}

function verificationSourceLabel(verification: EngineVerification) {
  switch (verification.source) {
    case "lichess":
      return "Lichess Cloud";
    case "chessdb":
      return "ChessDB";
    case "local":
      return "Stockfish";
  }
}

function gapKey(gap: RepertoireGap) {
  return `${gap.normalizedFen}|${gap.playerMoveUci}`;
}

function sortOpeningHealthRows(
  rows: RepertoireGap[],
  verifications: Record<string, EngineVerification>,
  colorFilter: OpeningHealthColorFilter,
  sortMode: OpeningHealthSortMode,
) {
  const filteredRows = rows.filter(
    (gap) => colorFilter === "any" || gap.sideToMove === colorFilter,
  );

  return [...filteredRows].sort((a, b) => {
    if (sortMode === "frequency") {
      return (
        b.playerPositionGames - a.playerPositionGames ||
        openingHealthRecencyScore(b.lastPlayed) - openingHealthRecencyScore(a.lastPlayed) ||
        openingHealthUrgency(b, verifications[gapKey(b)]) -
          openingHealthUrgency(a, verifications[gapKey(a)]) ||
        a.ply - b.ply
      );
    }

    return (
      openingHealthUrgency(b, verifications[gapKey(b)]) -
        openingHealthUrgency(a, verifications[gapKey(a)]) ||
      b.playerPositionGames - a.playerPositionGames ||
      openingHealthRecencyScore(b.lastPlayed) - openingHealthRecencyScore(a.lastPlayed) ||
      a.ply - b.ply
    );
  });
}

function selectRowsForEngineVerification(
  rows: RepertoireGap[],
  verifications: Record<string, EngineVerification>,
  colorFilter: OpeningHealthColorFilter,
) {
  return sortOpeningHealthRows(rows, verifications, colorFilter, "priority")
    .filter((gap) => !verifications[gapKey(gap)])
    .sort(
      (a, b) =>
        openingHealthUrgency(b, undefined) - openingHealthUrgency(a, undefined) ||
        b.playerPositionGames - a.playerPositionGames ||
        openingHealthRecencyScore(b.lastPlayed) - openingHealthRecencyScore(a.lastPlayed) ||
        a.ply - b.ply,
    );
}

function selectRowsForLichessDeepVerification(
  rows: RepertoireGap[],
  verifications: Map<string, EngineVerification>,
) {
  return [...rows]
    .sort(
      (a, b) =>
        openingHealthUrgency(b, verifications.get(gapKey(b))) -
          openingHealthUrgency(a, verifications.get(gapKey(a))) ||
        b.playerPositionGames - a.playerPositionGames ||
        openingHealthRecencyScore(b.lastPlayed) - openingHealthRecencyScore(a.lastPlayed) ||
        a.ply - b.ply,
    )
    .slice(0, LICHESS_DEEP_VERIFY_LIMIT);
}

function selectOpeningHealthEngine(engines: Engine[]): LocalEngine | null {
  const localEngines = engines.filter(
    (engine): engine is LocalEngine => engine.type === "local" && Boolean(engine.loaded),
  );
  return (
    localEngines.find((engine) => engine.name.toLowerCase().includes("stockfish")) ??
    localEngines[0] ??
    null
  );
}

function openingHealthUrgency(gap: RepertoireGap, verification?: EngineVerification) {
  const frequency = clamp(Math.log1p(gap.playerPositionGames) / Math.log1p(1000), 0, 1);
  const recency = openingHealthRecencyScore(gap.lastPlayed);
  const resultPressure = openingHealthResultPressure(gap);
  const unusualMove = clamp(gap.popularityGap, 0, 1);
  const practicalScore =
    resultPressure * 0.48 + frequency * 0.28 + recency * 0.18 + unusualMove * 0.06;

  if (!verification || verification.status === "missing") return practicalScore;

  const engineScore = openingHealthEngineSeverity(verification.lossCp);
  const engineWeight =
    engineScore <= 0.12 ? 0.08 : 0.1 + clamp((engineScore - 0.12) / 0.88, 0, 1) * 0.28;
  return practicalScore * (1 - engineWeight) + engineScore * engineWeight;
}

function openingHealthResultPressure(gap: RepertoireGap) {
  const resultGap = clamp(gap.scoreGap / 0.3, 0, 1);
  const poorAbsoluteScore = clamp((0.55 - gap.playerScore) / 0.4, 0, 1);
  const sampleConfidence = clamp(Math.log1p(gap.playerPositionGames) / Math.log1p(40), 0.35, 1);
  return (resultGap * 0.72 + poorAbsoluteScore * 0.28) * sampleConfidence;
}

function openingHealthEngineSeverity(lossCp: number) {
  if (lossCp <= 0) return 0;
  if (lossCp <= ENGINE_SIGNIFICANT_DROP_CP) {
    return (lossCp / ENGINE_SIGNIFICANT_DROP_CP) * 0.12;
  }

  const largeDrop = clamp((lossCp - ENGINE_SIGNIFICANT_DROP_CP) / 150, 0, 1);
  return 0.12 + Math.pow(largeDrop, 0.65) * 0.88;
}

function openingHealthRecencyScore(lastPlayed: string | null | undefined) {
  const date = parseOpeningHealthDate(lastPlayed);
  if (!date) return 0.35;

  const ageYears = Math.max(0, (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return clamp(Math.exp(-ageYears / 4), 0.08, 1);
}

function parseOpeningHealthDate(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLastPlayed(lastPlayed: string | null | undefined) {
  return formatOpeningReviewLastPlayed(lastPlayed);
}

function buildLichessCloudVerification(
  gap: RepertoireGap,
  moves: LichessCloudMove[],
): EngineVerification | null {
  const scoredMoves = moves
    .map((move) => ({
      move,
      scoreForSide: scoreForGapSide(move.scoreCpForWhite, gap.sideToMove),
    }))
    .sort((a, b) => b.scoreForSide - a.scoreForSide || a.move.san.localeCompare(b.move.san));
  const bestMove = scoredMoves[0];
  const playedMoveIndex = scoredMoves.findIndex((entry) => entry.move.uci === gap.playerMoveUci);
  const playedMove = playedMoveIndex >= 0 ? scoredMoves[playedMoveIndex] : null;

  if (!bestMove) return null;

  if (!playedMove) {
    return {
      status: "bad",
      source: "lichess",
      lossCp: CHESSDB_UNSCORED_MOVE_LOSS_CP,
      depth: bestMove.move.depth,
      bestMoveSan: bestMove.move.san,
      bestMoveUci: bestMove.move.uci,
      playedRank: null,
      checkedAt: Date.now(),
    };
  }

  const lossCp = Math.max(0, bestMove.scoreForSide - playedMove.scoreForSide);
  const status: EngineVerificationStatus =
    lossCp >= 120 ? "bad" : lossCp >= 60 ? "questionable" : "ok";

  return {
    status,
    source: "lichess",
    lossCp,
    depth: Math.min(bestMove.move.depth, playedMove.move.depth),
    bestMoveSan: bestMove.move.san,
    bestMoveUci: bestMove.move.uci,
    playedRank: playedMoveIndex + 1,
    checkedAt: Date.now(),
  };
}

function buildChessDbCloudVerification(
  gap: RepertoireGap,
  moves: ChessDbCloudMove[],
): EngineVerification | null {
  const scoredMoves = moves
    .filter((move) => move.scoreCpForWhite !== null)
    .map((move) => ({
      move,
      scoreForSide: scoreForGapSide(move.scoreCpForWhite!, gap.sideToMove),
    }))
    .sort(
      (a, b) =>
        b.scoreForSide - a.scoreForSide ||
        (b.move.rank ?? -1) - (a.move.rank ?? -1) ||
        a.move.san.localeCompare(b.move.san),
    );
  const bestMove = scoredMoves[0];
  const playedMoveIndex = scoredMoves.findIndex((entry) => entry.move.uci === gap.playerMoveUci);
  const playedMove = playedMoveIndex >= 0 ? scoredMoves[playedMoveIndex] : null;
  const rawPlayedMove = moves.find((move) => move.uci === gap.playerMoveUci);

  if (!bestMove) return null;

  if (!playedMove) {
    return {
      status: "bad",
      source: "chessdb",
      lossCp: CHESSDB_UNSCORED_MOVE_LOSS_CP,
      depth: null,
      bestMoveSan: bestMove.move.san,
      bestMoveUci: bestMove.move.uci,
      playedRank: rawPlayedMove?.rank ?? null,
      checkedAt: Date.now(),
    };
  }

  const lossCp = Math.max(0, bestMove.scoreForSide - playedMove.scoreForSide);
  const status: EngineVerificationStatus =
    lossCp >= 120 ? "bad" : lossCp >= 60 ? "questionable" : "ok";

  return {
    status,
    source: "chessdb",
    lossCp,
    depth: null,
    bestMoveSan: bestMove.move.san,
    bestMoveUci: bestMove.move.uci,
    playedRank: playedMoveIndex + 1,
    checkedAt: Date.now(),
  };
}

function buildMissingCloudVerification(): EngineVerification {
  return {
    status: "missing",
    source: "chessdb",
    lossCp: 0,
    depth: null,
    bestMoveSan: null,
    bestMoveUci: null,
    playedRank: null,
    checkedAt: Date.now(),
  };
}

async function getOpeningHealthEngineLines(
  engine: LocalEngine,
  tab: string,
  fen: string,
  depth: number,
): Promise<BestMoves[]> {
  const moves: string[] = [];

  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settle(null, new Error("Engine verification timed out."));
    }, ENGINE_VERIFY_TIMEOUT_MS);

    const unlisten = events.bestMovesPayload.listen(({ payload }) => {
      if (
        payload.engine === engine.id &&
        payload.tab === tab &&
        payload.fen === fen &&
        payload.moves.length === 0 &&
        payload.progress >= 100 &&
        payload.bestLines.length > 0
      ) {
        settle(payload.bestLines);
      }
    });

    function settle(bestMoves: BestMoves[] | null, error?: Error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unlisten.then((cleanup) => cleanup());
      if (bestMoves) {
        resolve(bestMoves);
      } else {
        reject(error ?? new Error("No engine lines returned."));
      }
    }

    void commands
      .getBestMoves(
        engine.id,
        engine.path,
        tab,
        { t: "Depth", c: depth },
        {
          fen,
          moves,
          extraOptions: [{ name: "MultiPV", value: String(ENGINE_VERIFY_MULTIPV) }],
        },
      )
      .then((result) => {
        if (result.status === "error") {
          settle(null, new Error(result.error));
        } else if (result.data?.[1]?.length) {
          settle(result.data[1]);
        }
      })
      .catch((error) => {
        settle(null, error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function buildEngineVerification(
  gap: RepertoireGap,
  bestMoves: BestMoves[],
  requestedDepth: number,
): EngineVerification {
  const ordered = [...bestMoves].sort((a, b) => a.multipv - b.multipv);
  const bestLine = ordered[0];
  const playedLine = ordered.find((line) => line.uciMoves[0] === gap.playerMoveUci);
  const bestScore = scoreForGapSide(bestLine ? engineScoreToCp(bestLine) : 0, gap.sideToMove);
  const playedScore = playedLine
    ? scoreForGapSide(engineScoreToCp(playedLine), gap.sideToMove)
    : bestScore - 300;
  const lossCp = Math.max(0, bestScore - playedScore);
  const status: EngineVerificationStatus =
    !playedLine || lossCp >= 120 ? "bad" : lossCp >= 60 ? "questionable" : "ok";
  const reachedDepth =
    ordered.length > 0
      ? Math.max(...ordered.map((line) => line.depth), requestedDepth)
      : requestedDepth;

  return {
    status,
    source: "local",
    lossCp,
    depth: reachedDepth,
    bestMoveSan: bestLine?.sanMoves[0] ?? null,
    bestMoveUci: bestLine?.uciMoves[0] ?? null,
    playedRank: playedLine?.multipv ?? null,
    checkedAt: Date.now(),
  };
}

function engineScoreToCp(line: BestMoves) {
  const score = line.score.value;
  if (score.type === "cp") return score.value;
  if (score.type !== "mate") return 0;
  const sign = score.value >= 0 ? 1 : -1;
  return sign * (100000 - Math.min(Math.abs(score.value), 100) * 1000);
}

function scoreForGapSide(cpForWhite: number, sideToMove: string) {
  return sideToMove === "black" ? -cpForWhite : cpForWhite;
}

function classificationColor(classification: RepertoireGap["classification"]) {
  switch (classification) {
    case "repertoireGap":
      return "red";
    case "preparedUnderperforming":
      return "orange";
    case "lowConfidence":
      return "yellow";
  }
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

export default memo(RepertoireGapsPanel);
