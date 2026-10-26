import { Button, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnalysisSearchControls } from "@/components/engines/AnalysisSearchControls";
import { engineSearchCapability } from "../../scripts/engine-search-protocol.mjs";
import { PHONE_PC_ENGINE_URL } from "./pcEngineHealth";
import { loadPcSearchCapability, type PcSearchCapability } from "./pcSearchLimits";
import {
  phoneSearchGo,
  phoneSearchLimit,
  type PhoneSearchPreferences,
} from "./phoneSearchPreferences";
import { phoneSearchSummary } from "./phoneSearchProgress";
import { createVerifiedJsonPreference, type BrowserPreferenceEdit } from "./verifiedJsonPreference";
export type PhoneSearchStore = ReturnType<
  typeof createVerifiedJsonPreference<PhoneSearchPreferences>
>;
export function usePhoneSearchCapability(active: boolean) {
  const [state, setState] = useState({
    capability: null as PcSearchCapability | null,
    checking: false,
    error: null as string | null,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let owned = true;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, checking: true, error: null }));
    const check = PHONE_PC_ENGINE_URL
      ? loadPcSearchCapability(controller.signal)
      : Promise.resolve(engineSearchCapability());
    void check.then(
      (capability) => {
        if (owned) setState({ capability, checking: false, error: null });
      },
      (error) => {
        if (owned)
          setState({
            capability: null,
            checking: false,
            error: error instanceof Error ? error.message : "Search controls could not be checked.",
          });
      },
    );
    return () => {
      owned = false;
      controller.abort();
    };
  }, [active, revision]);
  return { ...state, retry: () => setRevision((value) => value + 1) };
}
export function PhoneSearchControls({
  store,
  legacy,
  state,
  unavailable,
  starting,
  onIntent,
  requestError,
}: {
  store: PhoneSearchStore;
  legacy: { depth: number; infinite: boolean; multipv: number };
  state: ReturnType<typeof usePhoneSearchCapability>;
  unavailable: boolean;
  starting: boolean;
  onIntent: () => void;
  requestError: string | null;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const go = useMemo(
    () =>
      phoneSearchGo(
        { limit: snapshot.value.limit, lines: null },
        { depth: legacy.depth, infinite: legacy.infinite },
      ),
    [snapshot.value.limit, legacy.depth, legacy.infinite],
  );
  const previous = useRef<BrowserPreferenceEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (snapshot.phase === "unreadable") return null;
  const bounds = state.capability;
  return (
    <Stack gap="xs">
      <AnalysisSearchControls
        go={go}
        lines={snapshot.value.lines ?? legacy.multipv}
        disabled={unavailable}
        limitsAvailable={Boolean(bounds) && !state.checking && !state.error}
        limitBounds={
          bounds
            ? { ...bounds, depth: { min: bounds.depth.min, max: Math.min(60, bounds.depth.max) } }
            : undefined
        }
        scope="Live analysis in this phone profile. Plans and game reports keep their own limits."
        successLabel="Search settings saved."
        prepare={(patch) => {
          onIntent();
          const limit = patch.go ? phoneSearchLimit(patch.go) : undefined;
          if (limit) {
            if (!bounds || state.checking || state.error)
              throw Error("Check search controls before changing this limit.");
            if (limit.mode !== "infinite") {
              const range = bounds[limit.mode === "time" ? "timeMs" : limit.mode];
              if (limit.value < range.min || limit.value > range.max)
                throw Error("Choose a search limit supported by this engine.");
            }
          }
          const edit = store.prepare((current) => ({
            ...current,
            ...(limit ? { limit } : {}),
            ...(patch.lines !== undefined ? { lines: patch.lines } : {}),
          }));
          return {
            owns: edit.owns,
            isApplied: edit.isApplied,
            async save() {
              edit.save();
              previous.current = edit;
            },
            async restore() {
              edit.restore();
            },
          };
        }}
      />
      {state.checking && !unavailable && (
        <Text size="xs" role="status">
          Checking search controls…
        </Text>
      )}
      {unavailable && (
        <Text size="xs" role="status">
          {starting
            ? "PC services are starting. Saved search settings are kept."
            : "PC services are off. Saved search settings are kept."}
        </Text>
      )}
      {state.error && !unavailable && (
        <Stack gap={4}>
          <Text size="xs" role="alert">
            {state.error}
          </Text>
          <Button size="compact-xs" variant="subtle" onClick={state.retry}>
            Retry search controls check
          </Button>
        </Stack>
      )}
      {(snapshot.value.limit !== null || snapshot.value.lines !== null) && (
        <>
          <Button
            size="xs"
            variant="default"
            disabled={unavailable || snapshot.pending || Boolean(snapshot.error)}
            onClick={() => {
              onIntent();
              try {
                store.prepare(() => ({ limit: null, lines: null })).save();
                setError(null);
              } catch (error) {
                setError(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            Use original search settings
          </Button>
          <Text size="xs" c="dimmed">
            Original settings: {legacy.multipv} lines ·{" "}
            {phoneSearchSummary(phoneSearchGo({ limit: null, lines: null }, legacy))}.
          </Text>
        </>
      )}
      {requestError && previous.current?.owns() && (
        <Button
          size="compact-xs"
          variant="subtle"
          disabled={unavailable || snapshot.pending || Boolean(snapshot.error)}
          onClick={() => {
            try {
              previous.current!.restore();
              previous.current = null;
              setError(null);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          Restore previous search settings
        </Button>
      )}
      {error && (
        <Text size="xs" role="alert">
          {error}
        </Text>
      )}
    </Stack>
  );
}
