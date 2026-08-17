import {
  ActionIcon,
  Autocomplete,
  Button,
  createTheme,
  Group,
  Input,
  localStorageColorSchemeManager,
  MantineProvider,
  Paper,
  Progress,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { getMatches } from "@tauri-apps/plugin-cli";
import { listen } from "@tauri-apps/api/event";
import { attachConsole, error as logError, info, warn } from "@tauri-apps/plugin-log";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { ContextMenuProvider } from "mantine-contextmenu";
import posthog from "posthog-js";
import { useEffect, useRef, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  activeTabAtom,
  boardStyleAtom,
  databaseConversionStateAtom,
  fontSizeAtom,
  mistakeReviewScanProgressAtom,
  pieceSetAtom,
  primaryColorAtom,
  referenceDbAtom,
  spellCheckAtom,
  storedDatabasesDirAtom,
  storedDocumentDirAtom,
  storedEnginesDirAtom,
  storedPuzzlesDirAtom,
  tabsAtom,
  telemetryEnabledAtom,
} from "./state/atoms";

import "@/styles/chessgroundBaseOverride.css";
import "@/styles/chessgroundColorsOverride.css";

import "@mantine/charts/styles.css";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/tiptap/styles.css";

import "mantine-contextmenu/styles.css";
import "mantine-datatable/styles.css";

import "@/styles/global.css";

import { commands, events } from "./bindings";
import { openFile } from "./utils/files";

const STALE_DOWNLOAD_CONVERSION_MS = 2 * 60 * 1000;
const STALE_DATABASE_CONVERSION_MS = 20 * 60 * 1000;
const FEATURE_PRELOAD_DELAY_MS = 700;

const colorSchemeManager = localStorageColorSchemeManager({
  key: "mantine-color-scheme",
});

import { getVersion } from "@tauri-apps/api/app";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import ErrorComponent from "@/components/ErrorComponent";
import { RouteStartupFallback } from "@/components/common/StartupProgress";
import { OpeningReviewAutoUpdateBanner } from "@/components/review/OpeningReviewAutoUpdateBanner";
import { readStoredDirectoryOverride } from "@/utils/directoryOverrides";
import { getDatabasesDir, getDocumentDir, getEnginesDir, getPuzzlesDir } from "@/utils/directories";
import { initUserAgent } from "@/utils/http";
import { getEffectivePieceSet } from "@/utils/boardStyle";
import { useSharedLichessSession } from "@/hooks/useSharedLichessSession";
import { useLichessStudyDatabaseAutoUpdater } from "@/utils/lichessStudyDatabaseAutoUpdate";
import { useOnlineDatabaseAutoUpdater } from "@/utils/onlineDatabaseAutoUpdate";
import { useMistakeReviewDeckAutoUpdater } from "@/utils/mistakeReviewAutoUpdate";
import { useOpeningReviewDeckAutoUpdater } from "@/utils/openingReviewAutoUpdate";
import { routeTree } from "./routeTree.gen";

export type Dirs = {
  documentDir: string;
  databasesDir: string;
  enginesDir: string;
  puzzlesDir: string;
};

let cachedDirs: Dirs | null = readStoredDirs();
let dirsRefreshPromise: Promise<Dirs> | null = null;

function readStoredDirs(): Dirs | null {
  const documentDir = readStoredDirectoryOverride("document-dir");
  const databasesDir = readStoredDirectoryOverride("databases-dir");
  const enginesDir = readStoredDirectoryOverride("engines-dir");
  const puzzlesDir = readStoredDirectoryOverride("puzzles-dir");

  if (!documentDir || !databasesDir || !enginesDir || !puzzlesDir) return null;

  return {
    documentDir,
    databasesDir,
    enginesDir,
    puzzlesDir,
  };
}

function commitDirs(dirs: Dirs) {
  const store = getDefaultStore();

  cachedDirs = dirs;

  store.set(storedDocumentDirAtom, dirs.documentDir);
  store.set(storedDatabasesDirAtom, dirs.databasesDir);
  store.set(storedEnginesDirAtom, dirs.enginesDir);
  store.set(storedPuzzlesDirAtom, dirs.puzzlesDir);
}

async function refreshDirs(): Promise<Dirs> {
  if (dirsRefreshPromise) return dirsRefreshPromise;

  dirsRefreshPromise = (async () => {
    const [documentDir, databasesDir, enginesDir, puzzlesDir] = await Promise.all([
      getDocumentDir(),
      getDatabasesDir(),
      getEnginesDir(),
      getPuzzlesDir(),
    ]);

    const dirs = {
      documentDir,
      databasesDir,
      enginesDir,
      puzzlesDir,
    };

    commitDirs(dirs);
    return dirs;
  })().finally(() => {
    dirsRefreshPromise = null;
  });

  return dirsRefreshPromise;
}

async function loadDirs(): Promise<Dirs> {
  if (cachedDirs) {
    void refreshDirs().catch((e) => warn(`Failed to refresh startup directories: ${e}`));
    return cachedDirs;
  }

  return refreshDirs();
}

const router = createRouter({
  routeTree,
  defaultErrorComponent: ErrorComponent,
  defaultPendingComponent: RouteStartupFallback,
  defaultPendingMs: 0,
  defaultPendingMinMs: 250,
  context: {
    loadDirs,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function MistakeReviewScanProgressBanner() {
  const progress = useAtomValue(mistakeReviewScanProgressAtom);
  const setProgress = useSetAtom(mistakeReviewScanProgressAtom);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!progress.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [progress.running]);

  if (!progress.running) return null;

  const percent = Math.round(progress.progress ?? 0);
  const gamesTotal = progress.gamesTotal || 0;
  const gamesText = `${progress.gamesAnalyzed}/${gamesTotal}`;
  const etaText = getMistakeReviewEtaText(progress, now);

  const togglePaused = () => {
    const requestId = progress.requestId;
    if (!requestId || progress.stopping) return;

    const paused = !progress.paused;
    setProgress((current) =>
      current.requestId === requestId
        ? {
            ...current,
            paused,
            phase: paused ? "Paused" : "Analyzing games",
          }
        : current,
    );
    void commands.setMistakeReviewScanPaused(requestId, paused).then((result) => {
      if (result.status === "error") {
        setProgress((current) =>
          current.requestId === requestId
            ? {
                ...current,
                paused: !paused,
                error: result.error,
              }
            : current,
        );
      }
    });
  };

  const stopScan = () => {
    const requestId = progress.requestId;
    if (!requestId || progress.stopping) return;

    setProgress((current) =>
      current.requestId === requestId
        ? {
            ...current,
            paused: false,
            stopping: true,
            phase: "Stopping",
          }
        : current,
    );
    void commands.cancelAnalysis(requestId);
  };

  return (
    <Paper
      withBorder
      shadow="md"
      p="xs"
      style={{
        position: "fixed",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 400,
        width: "min(44rem, calc(100vw - 2rem))",
      }}
    >
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <Text size="sm" fw={700} truncate>
          {progress.deckName ?? "Mistake Review"}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {percent}%
          </Text>
          <Button
            size="compact-xs"
            variant="light"
            onClick={togglePaused}
            disabled={progress.stopping}
          >
            {progress.paused ? "Resume" : "Pause"}
          </Button>
          <Button
            size="compact-xs"
            variant="light"
            color="red"
            onClick={stopScan}
            loading={progress.stopping}
          >
            Stop
          </Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mb={4}>
        {progress.phase ?? "Analyzing games with Stockfish"}
      </Text>
      <Group gap="md" mb={6}>
        <Text size="xs">
          Games <b>{gamesText}</b>
        </Text>
        <Text size="xs">
          ETA <b>{etaText}</b>
        </Text>
        <Text size="xs">
          Positions <b>{progress.positionsAnalyzed}</b>
        </Text>
        <Text size="xs">
          Candidates <b>{progress.candidateMoves}</b>
        </Text>
        <Text size="xs">
          Mistakes <b>{progress.mistakesFound}</b>
        </Text>
      </Group>
      <Progress value={progress.progress ?? 0} size="sm" />
    </Paper>
  );
}

function getMistakeReviewEtaText(
  progress: {
    gamesAnalyzed: number;
    gamesTotal: number;
    progress: number | null;
    startedAt: number | null;
    paused: boolean;
    stopping: boolean;
  },
  now: number,
) {
  if (progress.stopping) return "stopping";
  if (progress.paused) return "paused";
  if (!progress.startedAt) return "estimating";

  const elapsedMs = Math.max(0, now - progress.startedAt);
  if (elapsedMs < 1000) return "estimating";

  if (progress.gamesTotal > 0 && progress.gamesAnalyzed > 0) {
    const remainingGames = Math.max(0, progress.gamesTotal - progress.gamesAnalyzed);
    if (remainingGames === 0) return "finishing";

    return formatEtaDuration((elapsedMs / progress.gamesAnalyzed) * remainingGames);
  }

  const progressRatio = Math.min(0.99, Math.max(0, (progress.progress ?? 0) / 100));
  if (progressRatio > 0) {
    return formatEtaDuration((elapsedMs / progressRatio) * (1 - progressRatio));
  }

  return "estimating";
}

function formatEtaDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

const checkForUpdates = async () => {
  try {
    const update = await check();
    if (update) {
      const yes = await ask("Do you want to install the new version now?", {
        title: "New version available",
      });
      if (yes) {
        await update.downloadAndInstall();
        await relaunch();
      }
    }
  } catch (e) {
    logError(`Failed to check for updates: ${e}`);
  }
};

const preloadReferenceDb = async (store: ReturnType<typeof getDefaultStore>) => {
  const referenceDb = store.get(referenceDbAtom);
  if (referenceDb) {
    info(`Preloading reference database: ${referenceDb}`);
    commands.preloadReferenceDb(referenceDb).catch((e: unknown) => {
      info(`Failed to preload reference database: ${e}`);
    });
  }
};

function scheduleIdleTask(callback: () => void, timeout = 2000) {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }

  const id = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(id);
}

function preloadAppFeatureChunks() {
  const preloads = [
    () => import("@/components/tabs/BoardsPage"),
    () => import("@/components/boards/BoardAnalysis"),
    () => import("@/components/tabs/NewTabHome"),
    () => import("@/components/files/FilesPage"),
    () => import("@/components/stats/StatsPage"),
    () => import("@/components/databases/DatabasesPage"),
    () => import("@/components/engines/EnginesPage"),
    () => import("@/components/settings/SettingsPage"),
  ];

  preloads.forEach((preload, index) => {
    window.setTimeout(
      () =>
        scheduleIdleTask(() => {
          void preload().catch((error) => warn(`Failed to preload feature chunk: ${error}`));
        }),
      FEATURE_PRELOAD_DELAY_MS + index * 350,
    );
  });
}

function useAppStartup() {
  const initialized = useRef(false);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const startupSequence = async () => {
      await commands.closeSplashscreen();
      await initUserAgent();

      const detach = await attachConsole();
      info("React app started successfully");

      checkForUpdates();
      refreshDirs().catch((e) => warn(`Failed to warm startup directories: ${e}`));
      window.setTimeout(preloadAppFeatureChunks, FEATURE_PRELOAD_DELAY_MS);

      const store = getDefaultStore();
      const telemetryEnabled = store.get(telemetryEnabledAtom);

      posthog.init("phc_kgEBtifs0EgWlrl4ROYEbnsQ1b7BS2W5BKLNyXe7f8z", {
        api_host: "https://app.posthog.com",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
      });

      if (telemetryEnabled) {
        posthog.capture("app_started", { version: await getVersion() });
      }
      try {
        const matches = await getMatches();
        if (matches.args.file.occurrences > 0) {
          info(`Opening file from command line: ${matches.args.file.value}`);
          if (typeof matches.args.file.value === "string") {
            const file = matches.args.file.value;
            openFile(file, setTabs, setActiveTab);
          }
        }
      } catch (e) {
        warn(`Failed to parse CLI args: ${e}`);
      }

      window.setTimeout(() => void preloadReferenceDb(store), 3000);

      return detach;
    };

    let detachFn: (() => void) | undefined;
    startupSequence().then((fn) => {
      detachFn = fn;
    });

    return () => {
      if (detachFn) detachFn();
    };
  }, [setTabs, setActiveTab]);
}

function useStopInteractiveEnginesWhenInactive() {
  const lastStopRef = useRef(0);

  useEffect(() => {
    const stopInteractiveEngines = () => {
      const now = Date.now();
      if (now - lastStopRef.current < 1000) return;
      lastStopRef.current = now;

      void commands.stopInteractiveEngines().catch((error) => {
        warn(`Could not stop interactive engines after app focus changed: ${error}`);
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopInteractiveEngines();
      }
    };

    window.addEventListener("blur", stopInteractiveEngines);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", stopInteractiveEngines);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}

export default function App() {
  const primaryColor = useAtomValue(primaryColorAtom);
  const pieceSet = useAtomValue(pieceSetAtom);
  const boardStyle = useAtomValue(boardStyleAtom);
  const effectivePieceSet = getEffectivePieceSet(boardStyle, pieceSet);
  const fontSize = useAtomValue(fontSizeAtom);
  const spellCheck = useAtomValue(spellCheckAtom);
  const [databaseConversionState, setDatabaseConversionState] = useAtom(
    databaseConversionStateAtom,
  );
  const setMistakeScanProgress = useSetAtom(mistakeReviewScanProgressAtom);

  useAppStartup();
  useSharedLichessSession();
  useStopInteractiveEnginesWhenInactive();
  useOnlineDatabaseAutoUpdater();
  useLichessStudyDatabaseAutoUpdater();
  useOpeningReviewDeckAutoUpdater();
  useMistakeReviewDeckAutoUpdater();

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}%`;
  }, [fontSize]);

  useEffect(() => {
    // Conversion state is persisted in sessionStorage, but the flow that owns
    // it dies with the previous document. Anything still marked in-progress at
    // mount is orphaned and would pin the banner on screen forever.
    setDatabaseConversionState((prev) =>
      prev.inProgress
        ? {
            ...prev,
            inProgress: false,
            phase: null,
            progress: null,
            progressId: null,
            sourceKind: null,
            startedAt: null,
            updatedAt: Date.now(),
            totalGames: 0,
            totalGamesExpected: null,
            elapsedSeconds: 0,
            targetDatabasePath: null,
            targetDatabaseTitle: null,
            sourceFileName: null,
          }
        : prev,
    );
  }, [setDatabaseConversionState]);

  useEffect(() => {
    if (!databaseConversionState.inProgress) return undefined;

    const staleAfter =
      databaseConversionState.phase === "downloading"
        ? STALE_DOWNLOAD_CONVERSION_MS
        : STALE_DATABASE_CONVERSION_MS;
    // A missing timestamp must count as stale, not disarm the watchdog:
    // in-progress state that never clears pins the banner on screen.
    const lastActivity =
      databaseConversionState.updatedAt ?? databaseConversionState.startedAt ?? 0;
    const delay = lastActivity + staleAfter - Date.now();

    const clearStaleConversion = () => {
      setDatabaseConversionState((prev) => {
        if (!prev.inProgress) return prev;
        const latestActivity = prev.updatedAt ?? prev.startedAt ?? 0;
        const latestStaleAfter =
          prev.phase === "downloading"
            ? STALE_DOWNLOAD_CONVERSION_MS
            : STALE_DATABASE_CONVERSION_MS;
        if (Date.now() - latestActivity < latestStaleAfter) return prev;

        return {
          ...prev,
          inProgress: false,
          phase: null,
          progress: null,
          progressId: null,
          sourceKind: null,
          startedAt: null,
          updatedAt: Date.now(),
          totalGames: 0,
          totalGamesExpected: null,
          elapsedSeconds: 0,
          targetDatabasePath: null,
          targetDatabaseTitle: null,
          sourceFileName: null,
        };
      });
    };

    if (delay <= 0) {
      clearStaleConversion();
      return undefined;
    }

    const timer = window.setTimeout(clearStaleConversion, delay);
    return () => window.clearTimeout(timer);
  }, [databaseConversionState, setDatabaseConversionState]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<number[]>("convert_progress", (event) => {
      const [totalGames, elapsedMs] = event.payload;
      setDatabaseConversionState((prev) => {
        // Only refresh a conversion some flow in this window owns. Forcing
        // inProgress on here let conversions without an owner (a backend
        // convert outliving a reload, or a trailing event after the owner's
        // reset) resurrect the banner with state nothing would ever clear.
        if (!prev.inProgress) return prev;

        return {
          ...prev,
          totalGames,
          elapsedSeconds: elapsedMs / 1000,
          phase: prev.phase ?? "converting",
          startedAt: prev.startedAt ?? Date.now(),
          updatedAt: Date.now(),
          progress:
            prev.totalGamesExpected && prev.totalGamesExpected > 0
              ? Math.min(99, (totalGames / prev.totalGamesExpected) * 100)
              : prev.progress,
        };
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [setDatabaseConversionState]);

  useEffect(() => {
    const unlisten = events.progressEvent.listen(({ payload }) => {
      setDatabaseConversionState((prev) => {
        if (!prev.inProgress || prev.progressId !== payload.id) {
          return prev;
        }

        return {
          ...prev,
          phase: "downloading",
          updatedAt: Date.now(),
          progress:
            prev.progress === null && payload.progress <= 0
              ? null
              : Math.max(prev.progress ?? 0, payload.progress),
        };
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setDatabaseConversionState]);

  useEffect(() => {
    const unlisten = events.mistakeReviewScanProgress.listen(({ payload }) => {
      setMistakeScanProgress((current) =>
        current.requestId === payload.id
          ? {
              ...current,
              running: !payload.finished,
              progress: payload.progress,
              gamesAnalyzed: payload.gamesAnalyzed,
              gamesTotal: payload.gamesTotal,
              positionsAnalyzed: payload.positionsAnalyzed,
              candidateMoves: payload.candidateMoves,
              mistakesFound: payload.mistakesFound,
              phase: payload.phase,
              paused: payload.paused,
              stopping: false,
              completedAt: payload.finished ? Date.now() : current.completedAt,
            }
          : current,
      );
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setMistakeScanProgress]);

  const theme = createTheme({
    primaryColor,
    colors: {
      dark: [
        "#C1C2C5",
        "#A6A7AB",
        "#909296",
        "#5c5f66",
        "#373A40",
        "#2C2E33",
        "#25262b",
        "#1A1B1E",
        "#141517",
        "#101113",
      ],
    },
    components: {
      ActionIcon: ActionIcon.extend({
        defaultProps: {
          variant: "transparent",
          color: "gray",
        },
      }),
      TextInput: TextInput.extend({ defaultProps: { spellCheck } }),
      Autocomplete: Autocomplete.extend({ defaultProps: { spellCheck } }),
      Textarea: Textarea.extend({ defaultProps: { spellCheck } }),
      Input: Input.extend({
        defaultProps: {
          // @ts-expect-error - Solve mantine input type check
          spellCheck,
        },
      }),
    },
  });

  return (
    <DndProvider backend={HTML5Backend}>
      <link rel="stylesheet" href={`/pieces/${effectivePieceSet}.css`} />

      <MantineProvider
        colorSchemeManager={colorSchemeManager}
        defaultColorScheme="dark"
        theme={theme}
      >
        <ContextMenuProvider>
          <Notifications />
          <OpeningReviewAutoUpdateBanner fixed />
          <MistakeReviewScanProgressBanner />
          <RouterProvider router={router} />
        </ContextMenuProvider>
      </MantineProvider>
    </DndProvider>
  );
}
