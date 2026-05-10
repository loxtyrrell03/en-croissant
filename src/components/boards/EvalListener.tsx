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
  stopEngine,
  stopMatchingEngine,
} from "@/utils/engines";
import { getBestMoves as lichessGetBestMoves } from "@/utils/lichess/api";
import { BoundedSet, withLimitedMapEntry } from "@/utils/boundedCache";
import { useThrottledEffect } from "@/utils/misc";
import { TreeStateContext } from "../common/TreeStateContext";

const LOCAL_ENGINE_CLOUD_PRIORITY_MS = 300;
const LOCAL_ENGINE_CLOUD_TIMEOUT_MS = 1500;
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

  const [pos] = positionFromFen(fen);

  useEffect(() => {
    if (active || !activeTab) return;

    for (const engine of engines ?? []) {
      if (engine.loaded && engine.type === "local") {
        void stopEngine(engine, activeTab);
      }
    }
  }, [active, activeTab, engines]);

  if (pos) {
    for (const uci of moves) {
      const move = parseUci(uci);
      if (!move) {
        console.log("Invalid move", uci);
        break;
      }
      pos.play(move);
    }
  }

  const isGameOver = pos?.isEnd() ?? false;
  const finalFen = useMemo(() => (pos ? makeFen(pos.toSetup()) : null), [pos]);

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

  const firstEngineWithLines = useAtomValue(
    firstEngineWithLinesFamily({
      fen: searchingFen,
      gameMoves: searchingMoves,
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
  const cloudCoveredSearchKeysRef = useRef(new BoundedSet<string>(MAX_ENGINE_RESULT_CACHE_ENTRIES));
  useEffect(() => {
    latestSearchKeyRef.current = searchKey;
  }, [searchKey]);

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
        !cloudCoveredSearchKeysRef.current.has(searchKey)
      ) {
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
          const shouldSetScore =
            firstEngineWithLines === engine.id || firstEngineWithLines === null;
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
    setEngineVariation,
    setProgress,
    firstEngineWithLines,
  ]);

  const getBestMoves = useMemo(
    () =>
      match(engine.type)
        .with(
          "local",
          () => (tab: string, goMode: GoMode, options: EngineOptions) =>
            getLocalBestMovesWithLichessCloud(engine as LocalEngine, tab, goMode, options),
        )
        .with("chessdb", () => chessdbGetBestMoves)
        .with("lichess", () => lichessGetBestMoves)
        .exhaustive(),
    [engine],
  );

  useThrottledEffect(
    () => {
      if (settings.enabled) {
        if (isGameOver) {
          if (engine.type === "local") {
            stopEngine(engine, activeTab!);
          }
        } else {
          const options =
            settings.settings?.map((s) => ({
              name: s.name,
              value: s.value?.toString() || "",
            })) ?? [];
          getBestMoves(activeTab!, settings.go, {
            moves: searchingMoves,
            fen: searchingFen,
            extraOptions: options,
          })
            .then((moves) => {
              if (moves) {
                const [progress, bestMoves] = moves;
                if (bestMoves.some((move) => move.source === "lichess")) {
                  cloudCoveredSearchKeysRef.current.add(searchKey);
                }
                setEngineVariation((prev) => {
                  return withLimitedMapEntry(
                    prev,
                    searchKey,
                    bestMoves,
                    MAX_ENGINE_RESULT_CACHE_ENTRIES,
                  );
                });
                if (latestSearchKeyRef.current === searchKey) {
                  setProgress(progress);
                  const shouldSetScore =
                    firstEngineWithLines === engine.id || firstEngineWithLines === null;
                  if (bestMoves.length > 0 && shouldSetScore) {
                    setLiveEval({
                      fen,
                      movesKey: displayedMovesKey,
                      score: bestMoves[0].score,
                    });
                  }
                }
              }
            })
            .catch((error) => {
              console.error(`Failed to start analysis for ${engine.name}`, error);
              if (latestSearchKeyRef.current !== searchKey) return;
              setEngineVariation((prev) => {
                return withLimitedMapEntry(prev, searchKey, [], MAX_ENGINE_RESULT_CACHE_ENTRIES);
              });
              setProgress(100);
            });
        }
      } else {
        if (engine.type === "local") {
          stopEngine(engine, activeTab!);
        }
      }
    },
    50,
    [
      settings.enabled,
      JSON.stringify(settings.settings),
      settings.go,
      searchingFen,
      searchingMovesKey,
      searchKey,
      isGameOver,
      activeTab,
      getBestMoves,
      setLiveEval,
      setProgress,
      setEngineVariation,
      engine,
      firstEngineWithLines,
      fen,
      displayedMovesKey,
    ],
  );
  return null;
}

async function getLocalBestMovesWithLichessCloud(
  engine: LocalEngine,
  tab: string,
  goMode: GoMode,
  options: EngineOptions,
) {
  const localStart = startLocalBestMoves(engine, tab, goMode, options);
  let cloudCoveredLocalSearch = false;
  // Keep Stockfish running behind cloud hits. Cloud replies can arrive after navigation,
  // so only stop the speculative local search if it still matches this exact request.
  const cloudPromise = withTimeout(
    lichessGetBestMoves(tab, goMode, options),
    LOCAL_ENGINE_CLOUD_TIMEOUT_MS,
  ).catch(() => null);

  try {
    const quickCloudMoves = await withTimeout(cloudPromise, LOCAL_ENGINE_CLOUD_PRIORITY_MS).catch(
      () => null,
    );

    if (quickCloudMoves?.[1]?.length) {
      cloudCoveredLocalSearch = true;
      return quickCloudMoves;
    }

    const cloudMoves = await cloudPromise;
    if (cloudMoves?.[1]?.length) {
      cloudCoveredLocalSearch = true;
      return cloudMoves;
    }

    return await localStart.promise;
  } finally {
    localStart.cleanup(cloudCoveredLocalSearch);
  }
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
      ]);
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("Timed out waiting for Lichess Cloud")), timeoutMs);
    }),
  ]);
}

export default EvalListener;
