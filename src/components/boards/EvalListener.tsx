import { parseUci } from "chessops";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import equal from "fast-deep-equal";
import { useAtom, useAtomValue } from "jotai";
import { startTransition, useContext, useEffect, useMemo, useRef } from "react";
import { match } from "ts-pattern";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { type BestMoves, type EngineOptions, events, type GoMode } from "@/bindings";
import {
  activeTabAtom,
  currentThreatAtom,
  currentLiveEvalAtom,
  type EngineCloudEvalStatus,
  engineCloudEvalStatusFamily,
  engineMovesFamily,
  engineProgressFamily,
  enginesAtom,
  firstEngineWithLinesFamily,
  tabEngineSettingsFamily,
} from "@/state/atoms";
import { getVariationLine } from "@/utils/chess";
import { getBestMoves as chessdbGetBestMoves } from "@/utils/chessdb/api";
import { positionFromFen, swapMove } from "@/utils/chessops";
import {
  type Engine,
  type LocalEngine,
  getBestMoves as localGetBestMoves,
  killEngine,
  stopEngine,
  stopMatchingEngine,
} from "@/utils/engines";
import {
  getBestMoves as lichessGetBestMoves,
  getLichessCloudFailure,
} from "@/utils/lichess/api";
import { BoundedSet, withLimitedMapEntry } from "@/utils/boundedCache";
import { TreeStateContext } from "../common/TreeStateContext";

const LOCAL_ENGINE_CLOUD_PRIORITY_MS = 300;
const LOCAL_ENGINE_CLOUD_TIMEOUT_MS = 1500;
const LOCAL_ENGINE_OUTPUT_TIMEOUT_MS = 12000;
const LOCAL_ENGINE_SEARCH_DELAY_MS = 260;
const REMOTE_ENGINE_SEARCH_DELAY_MS = 120;
const LOCAL_ENGINE_UI_UPDATE_INTERVAL_MS = 700;
const MAX_ENGINE_RESULT_CACHE_ENTRIES = 80;

function EvalListener({ active }: { active: boolean }) {
  const [engines] = useAtom(enginesAtom);
  const threat = useAtomValue(currentThreatAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.root.fen);

  const moves = useStore(
    store,
    useShallow((s) => getVariationLine(s.root, s.position)),
  );

  const analysedPosition = useMemo(() => {
    const [pos] = positionFromFen(fen);
    if (!pos) {
      return {
        finalFen: null,
        isGameOver: false,
      };
    }

    for (const uci of moves) {
      const move = parseUci(uci);
      if (!move) {
        console.log("Invalid move", uci);
        break;
      }
      pos.play(move);
    }

    return {
      finalFen: makeFen(pos.toSetup()),
      isGameOver: pos.isEnd(),
    };
  }, [fen, moves]);

  useEffect(() => {
    if (active || !activeTab) return;

    for (const engine of engines ?? []) {
      if (engine.loaded && engine.type === "local") {
        void stopEngine(engine, activeTab);
      }
    }
  }, [active, activeTab, engines]);

  const { finalFen, isGameOver } = analysedPosition;

  const { searchingFen, searchingMoves } = useMemo(
    () =>
      match(threat as boolean)
        .with(true, () => ({
          searchingFen: swapMove(finalFen || INITIAL_FEN),
          searchingMoves: [],
        }))
        .with(false, () => ({
          searchingFen: fen,
          searchingMoves: moves,
        }))
        .exhaustive(),
    [fen, moves, threat, finalFen],
  );
  const searchingMovesKey = useMemo(() => searchingMoves.join(","), [searchingMoves]);
  const searchingFinalFen = threat ? searchingFen : finalFen || INITIAL_FEN;

  const firstEngineWithLines = useAtomValue(
    firstEngineWithLinesFamily({
      fen: searchingFen,
      gameMoves: searchingMoves,
      finalFen: searchingFinalFen,
      gameMovesKey: searchingMovesKey,
    }),
  );

  if (!active) {
    return null;
  }

  return (engines ?? [])
    .filter((e) => e.loaded)
    .map((e) => (
      <EngineListener
        key={e.id}
        engine={e}
        firstEngineWithLines={firstEngineWithLines}
        isGameOver={isGameOver}
        finalFen={finalFen || ""}
        searchingFen={searchingFen}
        searchingMoves={searchingMoves}
        fen={fen}
        moves={moves}
        threat={threat}
      />
    ));
}

function EngineListener({
  engine,
  firstEngineWithLines,
  isGameOver,
  finalFen,
  searchingFen,
  searchingMoves,
  fen,
  moves,
  threat,
}: {
  engine: Engine;
  firstEngineWithLines: string | null;
  isGameOver: boolean;
  finalFen: string;
  searchingFen: string;
  searchingMoves: string[];
  fen: string;
  moves: string[];
  threat: boolean;
}) {
  const activeTab = useAtomValue(activeTabAtom);
  const [, setLiveEval] = useAtom(currentLiveEvalAtom);

  const [, setProgress] = useAtom(engineProgressFamily({ engine: engine.id, tab: activeTab! }));
  const [, setCloudEvalStatus] = useAtom(
    engineCloudEvalStatusFamily({ engine: engine.id, tab: activeTab! }),
  );

  const [, setEngineVariation] = useAtom(engineMovesFamily({ engine: engine.id, tab: activeTab! }));
  const [settings] = useAtom(
    tabEngineSettingsFamily({
      engineId: engine.id,
      defaultSettings: engine.settings ?? undefined,
      defaultGo: engine.go ?? undefined,
      tab: activeTab!,
    }),
  );
  const searchingMovesKey = useMemo(() => searchingMoves.join(","), [searchingMoves]);
  const searchKey = useMemo(
    () => `${searchingFen}:${searchingMovesKey}`,
    [searchingFen, searchingMovesKey],
  );
  const displayedMovesKey = useMemo(() => moves.join(","), [moves]);
  const latestSearchKeyRef = useRef(searchKey);
  const requestSequenceRef = useRef(0);
  const lastPayloadUiUpdateRef = useRef(0);
  const firstEngineWithLinesRef = useRef(firstEngineWithLines);
  const cloudCoveredSearchKeysRef = useRef(new BoundedSet<string>(MAX_ENGINE_RESULT_CACHE_ENTRIES));
  useEffect(() => {
    latestSearchKeyRef.current = searchKey;
  }, [searchKey]);
  useEffect(() => {
    firstEngineWithLinesRef.current = firstEngineWithLines;
  }, [firstEngineWithLines]);

  useEffect(() => {
    return () => {
      if (engine.type === "local" && activeTab) {
        void stopEngine(engine, activeTab);
      }
    };
  }, [activeTab, engine]);

  useEffect(() => {
    if (!settings.enabled) return;
    const unlisten = events.bestMovesPayload.listen(({ payload }) => {
      const ev = payload.bestLines;
      if (
        payload.engine === engine.id &&
        payload.tab === activeTab &&
        payload.fen === searchingFen &&
        equal(payload.moves, searchingMoves) &&
        settings.enabled &&
        !isGameOver &&
        latestSearchKeyRef.current === searchKey &&
        !cloudCoveredSearchKeysRef.current.has(searchKey)
      ) {
        const now = performance.now();
        const isFinalPayload = payload.progress >= 100;
        if (
          engine.type === "local" &&
          !isFinalPayload &&
          now - lastPayloadUiUpdateRef.current < LOCAL_ENGINE_UI_UPDATE_INTERVAL_MS
        ) {
          return;
        }
        lastPayloadUiUpdateRef.current = now;

        startTransition(() => {
          setEngineVariation((prev) => {
            const staleKeys = threat
              ? [`${fen}:${displayedMovesKey}`]
              : finalFen
                ? [`${swapMove(finalFen)}:`]
                : [];
            return withLimitedMapEntry(
              prev,
              searchKey,
              ev,
              MAX_ENGINE_RESULT_CACHE_ENTRIES,
              staleKeys,
            );
          });
          setProgress(payload.progress);
          const currentFirstEngineWithLines = firstEngineWithLinesRef.current;
          const shouldSetScore =
            currentFirstEngineWithLines === engine.id || currentFirstEngineWithLines === null;
          if (shouldSetScore && ev[0]) {
            setLiveEval({
              fen,
              movesKey: displayedMovesKey,
              score: ev[0].score,
            });
          }
        });
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [
    activeTab,
    setLiveEval,
    settings.enabled,
    isGameOver,
    fen,
    moves,
    displayedMovesKey,
    finalFen,
    threat,
    searchingFen,
    searchingMoves,
    searchingMovesKey,
    searchKey,
    engine.id,
    engine.type,
    setEngineVariation,
    setProgress,
  ]);

  const settingsOptionsKey = useMemo(() => JSON.stringify(settings.settings ?? []), [
    settings.settings,
  ]);
  const engineExtraOptions = useMemo<EngineOptions["extraOptions"]>(() => {
    const settingsList = JSON.parse(settingsOptionsKey) as {
      name: string;
      value?: string | number | boolean | null;
    }[];
    return settingsList.map((s) => ({
      name: s.name,
      value: s.value?.toString() || "",
    }));
  }, [settingsOptionsKey]);
  const engineOptions = useMemo<EngineOptions>(
    () => ({
      moves: searchingMoves,
      fen: searchingFen,
      extraOptions: engineExtraOptions,
    }),
    [engineExtraOptions, searchingFen, searchingMoves],
  );

  useEffect(() => {
    if (!activeTab) return;

    const tab = activeTab;
    const requestId = ++requestSequenceRef.current;
    const searchDelay =
      engine.type === "local" ? LOCAL_ENGINE_SEARCH_DELAY_MS : REMOTE_ENGINE_SEARCH_DELAY_MS;
    let cancelled = false;
    let startedLocalSearch = false;

    if (!settings.enabled) {
      if (engine.type === "local") {
        void stopEngine(engine, tab);
      }
      return;
    }

    if (isGameOver) {
      if (engine.type === "local") {
        void stopEngine(engine, tab);
      }
      return;
    }

    const timer = window.setTimeout(() => {
      if (cancelled || requestSequenceRef.current !== requestId) return;

      startedLocalSearch = engine.type === "local";
      const updateCloudStatus = (status: EngineCloudEvalStatus) => {
        if (
          cancelled ||
          requestSequenceRef.current !== requestId ||
          latestSearchKeyRef.current !== searchKey
        ) {
          return;
        }
        startTransition(() => {
          setCloudEvalStatus((prev) =>
            withLimitedMapEntry(prev, searchKey, status, MAX_ENGINE_RESULT_CACHE_ENTRIES),
          );
        });
      };

      const bestMovesPromise =
        engine.type === "local"
          ? getLocalBestMovesWithLichessCloud(
              engine,
              tab,
              settings.go,
              engineOptions,
              updateCloudStatus,
            )
          : engine.type === "lichess"
            ? getLichessBestMovesWithStatus(tab, settings.go, engineOptions, updateCloudStatus)
            : chessdbGetBestMoves(tab, settings.go, engineOptions);

      bestMovesPromise
        .then((moves) => {
          if (
            cancelled ||
            requestSequenceRef.current !== requestId ||
            latestSearchKeyRef.current !== searchKey ||
            !moves
          ) {
            return;
          }

          const [progress, bestMoves] = moves;
          const cloudCovered = bestMoves.some(
            (move) => (move as BestMoves & { source?: string }).source === "lichess",
          );
          if (cloudCovered) {
            cloudCoveredSearchKeysRef.current.add(searchKey);
          }

          // Local engine payloads are already applied by the event listener. Avoid
          // duplicating the same update from the request promise while users move.
          if (engine.type === "local" && !cloudCovered) {
            return;
          }

          startTransition(() => {
            setEngineVariation((prev) => {
              return withLimitedMapEntry(
                prev,
                searchKey,
                bestMoves,
                MAX_ENGINE_RESULT_CACHE_ENTRIES,
              );
            });
            setProgress(progress);
            const currentFirstEngineWithLines = firstEngineWithLinesRef.current;
            const shouldSetScore =
              currentFirstEngineWithLines === engine.id || currentFirstEngineWithLines === null;
            if (bestMoves.length > 0 && shouldSetScore) {
              setLiveEval({
                fen,
                movesKey: displayedMovesKey,
                score: bestMoves[0].score,
              });
            }
          });
        })
        .catch((error) => {
          if (
            cancelled ||
            requestSequenceRef.current !== requestId ||
            latestSearchKeyRef.current !== searchKey
          ) {
            return;
          }
          console.error(`Failed to start analysis for ${engine.name}`, error);
          startTransition(() => {
            setEngineVariation((prev) => {
              return withLimitedMapEntry(prev, searchKey, [], MAX_ENGINE_RESULT_CACHE_ENTRIES);
            });
            setProgress(100);
          });
        });
    }, searchDelay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (startedLocalSearch && engine.type === "local") {
        void stopMatchingEngine(engine, tab, settings.go, engineOptions).catch((error) => {
          console.error(`Failed to cancel stale analysis for ${engine.name}`, error);
        });
      }
    };
  }, [
    activeTab,
    displayedMovesKey,
    engine,
    engineOptions,
    fen,
    isGameOver,
    searchKey,
    searchingFen,
    searchingMovesKey,
    setCloudEvalStatus,
    setEngineVariation,
    setLiveEval,
    setProgress,
    settings.enabled,
    settings.go,
    settingsOptionsKey,
  ]);
  return null;
}

async function getLocalBestMovesWithLichessCloud(
  engine: LocalEngine,
  tab: string,
  goMode: GoMode,
  options: EngineOptions,
  updateCloudStatus: (status: EngineCloudEvalStatus) => void,
) {
  const localStart = startLocalBestMoves(engine, tab, goMode, options);
  let cloudCoveredLocalSearch = false;
  updateCloudStatus({
    phase: "checking",
    message: "Checking Lichess Cloud...",
    updatedAt: Date.now(),
  });

  try {
    const cloudMoves = await lichessGetBestMoves(tab, goMode, options);
    if (cloudMoves?.[1]?.length) {
      cloudCoveredLocalSearch = true;
      updateCloudStatus({
        phase: "available",
        message: formatCloudAvailableMessage(cloudMoves[1]),
        updatedAt: Date.now(),
      });
      return cloudMoves;
    }

    updateCloudStatus({
      phase: "missing",
      message: "Lichess Cloud returned no analysis lines for this position.",
      updatedAt: Date.now(),
    });
    return await localStart.promise;
  } catch (error) {
    updateCloudStatus(cloudFailureStatus(error));
    return await localStart.promise;
  } finally {
    localStart.cleanup(cloudCoveredLocalSearch);
  }
}

async function getLichessBestMovesWithStatus(
  tab: string,
  goMode: GoMode,
  options: EngineOptions,
  updateCloudStatus: (status: EngineCloudEvalStatus) => void,
) {
  updateCloudStatus({
    phase: "checking",
    message: "Checking Lichess Cloud...",
    updatedAt: Date.now(),
  });
  try {
    const cloudMoves = await lichessGetBestMoves(tab, goMode, options);
    if (cloudMoves?.[1]?.length) {
      updateCloudStatus({
        phase: "available",
        message: formatCloudAvailableMessage(cloudMoves[1]),
        updatedAt: Date.now(),
      });
    } else {
      updateCloudStatus({
        phase: "missing",
        message: "Lichess Cloud returned no analysis lines for this position.",
        updatedAt: Date.now(),
      });
    }
    return cloudMoves;
  } catch (error) {
    updateCloudStatus(cloudFailureStatus(error));
    throw error;
  }
}

function cloudFailureStatus(error: unknown): EngineCloudEvalStatus {
  const failure = getLichessCloudFailure(error);
  return {
    phase: failure.reason === "missing" ? "missing" : "error",
    message: failure.message,
    detail: failure.detail,
    updatedAt: Date.now(),
  };
}

function formatCloudAvailableMessage(bestMoves: BestMoves[]) {
  const firstLine = bestMoves[0];
  const depth = firstLine?.depth ? `depth ${firstLine.depth}` : "ready";
  const lines = bestMoves.length === 1 ? "1 line" : `${bestMoves.length} lines`;
  return `Using Lichess Cloud ${depth}, ${lines}.`;
}

function startLocalBestMoves(
  engine: LocalEngine,
  tab: string,
  goMode: GoMode,
  options: EngineOptions,
): { promise: Promise<[number, BestMoves[]] | null>; cleanup: (stopSearch: boolean) => void } {
  let unlisten: (() => void) | null = null;
  let resolveEvent: ((value: [number, BestMoves[]] | null) => void) | null = null;
  let disposed = false;

  const eventPromise = new Promise<[number, BestMoves[]] | null>((resolve) => {
    resolveEvent = resolve;
  });

  const promise = (async () => {
    try {
      unlisten = await events.bestMovesPayload.listen(({ payload }) => {
        if (
          payload.engine === engine.id &&
          payload.tab === tab &&
          payload.fen === options.fen &&
          equal(payload.moves, options.moves) &&
          payload.bestLines.length > 0
        ) {
          resolveEvent?.([payload.progress, payload.bestLines]);
        }
      });

      if (disposed) {
        return null;
      }

      return await Promise.race([
        localGetBestMoves(engine, tab, goMode, options).then((moves) =>
          moves?.[1]?.length ? moves : eventPromise,
        ),
        eventPromise,
        rejectAfter<[number, BestMoves[]] | null>(
          LOCAL_ENGINE_OUTPUT_TIMEOUT_MS,
          `Timed out waiting for ${engine.name} to return analysis`,
        ),
      ]);
    } catch (error) {
      void killEngine(engine, tab).catch((killError) => {
        console.error(`Failed to restart stalled analysis for ${engine.name}`, killError);
      });
      throw error;
    } finally {
      unlisten?.();
    }
  })();

  return {
    promise,
    cleanup: (stopSearch: boolean) => {
      disposed = true;
      unlisten?.();
      resolveEvent?.(null);
      if (stopSearch) {
        void stopMatchingEngine(engine, tab, goMode, options).catch((error) => {
          console.error(`Failed to stop covered local analysis for ${engine.name}`, error);
        });
      }
    },
  };
}

function rejectAfter<T>(timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
}

export default EvalListener;
