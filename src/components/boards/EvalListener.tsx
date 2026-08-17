import { parseUci } from "chessops";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import equal from "fast-deep-equal";
import { useAtom, useAtomValue } from "jotai";
import { startTransition, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { positionFromFen, swapMove } from "@/utils/chessops";
import {
  type Engine,
  type LocalEngine,
  getBestMoves as localGetBestMoves,
  killEngine,
  stopEngine,
  stopMatchingEngine,
} from "@/utils/engines";
import { getBestMoves as lichessGetBestMoves, getLichessCloudFailure } from "@/utils/lichess/api";
import { BoundedSet, withLimitedMapEntry } from "@/utils/boundedCache";
import { TreeStateContext } from "../common/TreeStateContext";

const LOCAL_ENGINE_OUTPUT_TIMEOUT_MS = 15000;
const LOCAL_ENGINE_TAIL_OUTPUT_TIMEOUT_MS = 12000;
const LOCAL_ENGINE_SEARCH_DELAY_MS = 0;
const REMOTE_ENGINE_SEARCH_DELAY_MS = 120;
const LOCAL_ENGINE_UI_UPDATE_INTERVAL_MS = 0;
const MAX_ENGINE_RESULT_CACHE_ENTRIES = 80;

function EvalListener({ active }: { active: boolean }) {
  const [engines] = useAtom(enginesAtom);
  const threat = useAtomValue(currentThreatAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const engineWakeRevision = useEngineWakeRevision(active);
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
        engineWakeRevision={engineWakeRevision}
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

function useEngineWakeRevision(active: boolean) {
  const [revision, setRevision] = useState(0);
  const inactiveRef = useRef(false);

  useEffect(() => {
    if (!active) return;

    const markInactive = () => {
      inactiveRef.current = true;
    };
    const wakeIfNeeded = () => {
      if (!inactiveRef.current || document.visibilityState === "hidden") return;
      inactiveRef.current = false;
      setRevision((value) => value + 1);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markInactive();
      } else {
        wakeIfNeeded();
      }
    };

    window.addEventListener("blur", markInactive);
    window.addEventListener("focus", wakeIfNeeded);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", markInactive);
      window.removeEventListener("focus", wakeIfNeeded);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [active]);

  return revision;
}

function EngineListener({
  engine,
  engineWakeRevision,
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
  engineWakeRevision: number;
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
        if (engine.type === "local" && ev.length === 0) {
          return;
        }
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

  const settingsOptionsKey = useMemo(
    () => JSON.stringify(settings.settings ?? []),
    [settings.settings],
  );
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
  const localWakeRevision = engine.type === "local" ? engineWakeRevision : 0;

  useEffect(() => {
    if (!activeTab) return;

    const tab = activeTab;
    const requestId = ++requestSequenceRef.current;
    const searchDelay =
      engine.type === "local" ? LOCAL_ENGINE_SEARCH_DELAY_MS : REMOTE_ENGINE_SEARCH_DELAY_MS;
    let cancelled = false;
    let startedLocalSearch = false;
    let localRestartAttempts = 0;
    let localRestartTimer: number | null = null;

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

    const startSearch = () => {
      if (cancelled || requestSequenceRef.current !== requestId) return;

      startedLocalSearch = engine.type === "local";
      if (engine.type === "local") {
        cloudCoveredSearchKeysRef.current.delete(searchKey);
        startTransition(() => {
          setProgress(0);
          setEngineVariation((prev) => withoutEmptyMapEntry(prev, searchKey));
        });
      }
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
          : getLichessBestMovesWithStatus(tab, settings.go, engineOptions, updateCloudStatus);

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

          // Local engine payloads are normally applied by the event listener. If the
          // search finished before the listener attached, or an already-running
          // search was rejoined (e.g. after window focus), the only copy of the
          // result is here — fill it in so the panel doesn't stay on skeletons.
          if (engine.type === "local" && !cloudCovered) {
            if (bestMoves.length === 0) {
              return;
            }
            startTransition(() => {
              let applied = false;
              setEngineVariation((prev) => {
                const existing = prev.get(searchKey);
                if (existing && existing.length > 0) return prev;
                applied = true;
                return withLimitedMapEntry(
                  prev,
                  searchKey,
                  bestMoves,
                  MAX_ENGINE_RESULT_CACHE_ENTRIES,
                );
              });
              if (!applied) return;
              setProgress(progress);
              const currentFirstEngineWithLines = firstEngineWithLinesRef.current;
              if (
                currentFirstEngineWithLines === engine.id ||
                currentFirstEngineWithLines === null
              ) {
                setLiveEval({
                  fen,
                  movesKey: displayedMovesKey,
                  score: bestMoves[0].score,
                });
              }
            });
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

          if (engine.type === "local" && cloudCovered && hasPartialCloudLines(bestMoves)) {
            void extendMissingCloudLinesWithLocalSearches(
              engine,
              tab,
              settings.go,
              engineOptions,
              bestMoves,
            ).then((extendedMoves) => {
              if (
                cancelled ||
                requestSequenceRef.current !== requestId ||
                latestSearchKeyRef.current !== searchKey
              ) {
                return;
              }
              startTransition(() => {
                setEngineVariation((prev) =>
                  withLimitedMapEntry(
                    prev,
                    searchKey,
                    extendedMoves,
                    MAX_ENGINE_RESULT_CACHE_ENTRIES,
                  ),
                );
              });
            });
          }
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
            if (engine.type === "local") {
              if (localRestartAttempts < 1) {
                setEngineVariation((prev) => withoutEmptyMapEntry(prev, searchKey));
                setProgress(0);
                return;
              }
              // Out of restart attempts — settle on "no analysis" instead of
              // leaving the panel stuck on loading skeletons.
              setEngineVariation((prev) => {
                const existing = prev.get(searchKey);
                if (existing && existing.length > 0) return prev;
                return withLimitedMapEntry(prev, searchKey, [], MAX_ENGINE_RESULT_CACHE_ENTRIES);
              });
              setProgress(100);
              return;
            }
            setEngineVariation((prev) => {
              return withLimitedMapEntry(prev, searchKey, [], MAX_ENGINE_RESULT_CACHE_ENTRIES);
            });
            setProgress(100);
          });
          if (engine.type === "local" && localRestartAttempts < 1) {
            localRestartAttempts++;
            localRestartTimer = window.setTimeout(startSearch, 250);
          }
        });
    };

    if (searchDelay > 0) {
      const timer = window.setTimeout(startSearch, searchDelay);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        if (localRestartTimer !== null) {
          window.clearTimeout(localRestartTimer);
        }
        if (startedLocalSearch && engine.type === "local") {
          void stopMatchingEngine(engine, tab, settings.go, engineOptions).catch((error) => {
            console.error(`Failed to cancel stale analysis for ${engine.name}`, error);
          });
        }
      };
    }

    startSearch();

    return () => {
      cancelled = true;
      if (localRestartTimer !== null) {
        window.clearTimeout(localRestartTimer);
      }
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
    localWakeRevision,
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

function withoutEmptyMapEntry(
  source: Map<string, BestMoves[]>,
  key: string,
): Map<string, BestMoves[]> {
  const existing = source.get(key);
  if (!existing || existing.length > 0) return source;
  const next = new Map(source);
  next.delete(key);
  return next;
}

async function getLocalBestMovesWithLichessCloud(
  engine: LocalEngine,
  tab: string,
  goMode: GoMode,
  options: EngineOptions,
  updateCloudStatus: (status: EngineCloudEvalStatus) => void,
) {
  let cloudLookupFailed = false;
  try {
    updateCloudStatus({
      phase: "checking",
      message: "Checking local Lichess evals...",
      updatedAt: Date.now(),
    });

    const cloudMoves = await lichessGetBestMoves(tab, goMode, options);
    if (cloudMoves?.[1]?.length) {
      updateCloudStatus({
        phase: "available",
        message: formatCloudAvailableMessage(cloudMoves[1]),
        updatedAt: Date.now(),
      });
      return cloudMoves;
    }
  } catch (error) {
    cloudLookupFailed = true;
    updateCloudStatus(cloudFailureStatus(error));
  }

  if (!cloudLookupFailed) {
    updateCloudStatus({
      phase: "missing",
      message: "No local Lichess eval was found for this position; using Stockfish.",
      updatedAt: Date.now(),
    });
  }
  const localStart = startLocalBestMoves(engine, tab, goMode, options, {
    timeoutMs: LOCAL_ENGINE_OUTPUT_TIMEOUT_MS,
  });
  try {
    return await localStart.promise;
  } finally {
    localStart.cleanup(false);
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
    message: "Checking local Lichess evals...",
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
        message: "No local Lichess eval was found for this position.",
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
  const hasExtendedLines = bestMoves.some((move) =>
    Boolean((move as CloudBackedBestMove).cloudLineExtendedWithLocal),
  );
  return hasExtendedLines
    ? `Using local Lichess evals ${depth}, ${lines}; Stockfish continuations.`
    : `Using local Lichess evals ${depth}, ${lines}.`;
}

type CloudBackedBestMove = BestMoves & {
  cloudLinePartial?: boolean;
  cloudLineExtendedWithLocal?: boolean;
  cloudLineForcedWithLocal?: boolean;
};

function hasPartialCloudLines(bestMoves: BestMoves[]) {
  return bestMoves.some((move) => Boolean((move as CloudBackedBestMove).cloudLinePartial));
}

async function extendMissingCloudLinesWithLocalSearches(
  engine: LocalEngine,
  tab: string,
  goMode: GoMode,
  options: EngineOptions,
  cloudMoves: BestMoves[],
) {
  let extendedMoves = cloudMoves;

  for (const [index, cloudMove] of extendedMoves.entries()) {
    const cloudState = cloudMove as CloudBackedBestMove;
    const firstMove = cloudMove.uciMoves[0];
    if (!cloudState.cloudLinePartial || !firstMove || cloudMove.uciMoves.length > 1) {
      continue;
    }

    const localMove = await getLocalContinuationAfterCloudMove(
      engine,
      tab,
      goMode,
      options,
      firstMove,
      index,
    );
    if (!localMove?.uciMoves.length) continue;

    extendedMoves = extendedMoves.map((candidate, candidateIndex) => {
      if (candidateIndex !== index) return candidate;
      return mergeCloudLineWithLocalTail(candidate, localMove, true);
    });
  }

  return extendedMoves;
}

async function getLocalContinuationAfterCloudMove(
  engine: LocalEngine,
  tab: string,
  goMode: GoMode,
  options: EngineOptions,
  firstMove: string,
  index: number,
) {
  const forcedOptions: EngineOptions = {
    ...options,
    moves: [...options.moves, firstMove],
    extraOptions: withMultiPv(options.extraOptions, 1),
  };
  const forcedTab = `${tab}:cloud-tail:${engine.id}:${index}:${firstMove}`;
  const localStart = startLocalBestMoves(engine, forcedTab, goMode, forcedOptions, {
    timeoutMs: LOCAL_ENGINE_TAIL_OUTPUT_TIMEOUT_MS,
  });

  try {
    const localMoves = await localStart.promise.catch((error) => {
      console.warn(`Failed to calculate local continuation after ${firstMove}.`, error);
      return null;
    });
    return localMoves?.[1]?.[0] ?? null;
  } finally {
    localStart.cleanup(true);
  }
}

function mergeCloudLineWithLocalTail(
  cloudMove: BestMoves,
  localMove: BestMoves,
  forced: boolean,
): CloudBackedBestMove {
  const firstMove = cloudMove.uciMoves[0];
  return {
    ...cloudMove,
    sanMoves: [cloudMove.sanMoves[0] ?? localMove.sanMoves[0] ?? firstMove, ...localMove.sanMoves],
    uciMoves: [firstMove, ...localMove.uciMoves],
    cloudLineExtendedWithLocal: true,
    cloudLineForcedWithLocal: forced,
    cloudLinePartial: false,
  };
}

function withMultiPv(
  extraOptions: EngineOptions["extraOptions"],
  multipv: number,
): EngineOptions["extraOptions"] {
  let found = false;
  const nextOptions = extraOptions.map((option) => {
    if (option.name !== "MultiPV") return option;
    found = true;
    return {
      ...option,
      value: String(multipv),
    };
  });
  if (!found) {
    nextOptions.push({
      name: "MultiPV",
      value: String(multipv),
    });
  }
  return nextOptions;
}

function startLocalBestMoves(
  engine: LocalEngine,
  tab: string,
  goMode: GoMode,
  options: EngineOptions,
  startOptions: { timeoutMs?: number } = {},
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

      const waits: Promise<[number, BestMoves[]] | null>[] = [
        localGetBestMoves(engine, tab, goMode, options).then((moves) =>
          moves?.[1]?.length ? moves : eventPromise,
        ),
        eventPromise,
      ];

      if (startOptions.timeoutMs !== undefined) {
        waits.push(
          rejectAfter<[number, BestMoves[]] | null>(
            startOptions.timeoutMs,
            `Timed out waiting for ${engine.name} to return analysis`,
          ),
        );
      }

      return await Promise.race(waits);
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
