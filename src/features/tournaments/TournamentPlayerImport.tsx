import {
  Alert,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Progress,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FidePlayerSearchInput } from "@/components/common/FidePlayerSearchInput";
import { getFideImportStartYear, type FidePlayer } from "@/utils/fidePlayer";
import { searchFidePlayers } from "@/utils/fideApi";
import { searchWebFidePlayers } from "@/web/otbImport";
import { desktopApi, isNativeDesktop } from "./platform";
import { HomeModal, HelpTip } from "./ui";
import { DEFAULT_OTB_IMPORT_SOURCES, OTB_IMPORT_SOURCE_DETAILS } from "./otbImportModel";
import {
  importOpponent,
  importView,
  restoreOpponentImport,
  stopOpponentImport,
  subscribeOpponentImports,
  type OpponentImportResult,
} from "./opponentImport";
import { OtbDownloadControl } from "./downloads/OtbDownloadControl";

export type OtbPlayerImportResult = OpponentImportResult;
const GENERAL_IMPORT_KEY = "encroissant.tournament.pending-player";
function savedGeneralKey() {
  try {
    return localStorage.getItem(GENERAL_IMPORT_KEY);
  } catch {
    return null;
  }
}
export function PlayerGameImportModal({
  initialOtb,
  onClose,
  onDone,
}: {
  initialOtb?: {
    playerName: string;
    fideId: string | null;
    fromYear: number;
    databaseName: string;
    collectionId?: number | null;
    lockIdentity?: boolean;
    requestKey?: string;
  };
  onClose: () => void;
  onDone: (id: number, message: string, result?: OtbPlayerImportResult) => void | Promise<void>;
}) {
  const [playerName, setPlayerName] = useState(initialOtb?.playerName ?? "");
  const [fideId, setFideId] = useState(initialOtb?.fideId ?? "");
  const [selected, setSelected] = useState<FidePlayer | null>(null);
  const [fromYear, setFromYear] = useState(initialOtb?.fromYear ?? new Date().getFullYear() - 3);
  const yearEdited = useRef(false);
  const [sources, setSources] = useState({ ...DEFAULT_OTB_IMPORT_SOURCES });
  const [key, setKey] = useState(
    () => initialOtb?.requestKey ?? savedGeneralKey() ?? `player-${crypto.randomUUID()}`,
  );
  const view = useSyncExternalStore(
    subscribeOpponentImports,
    () => importView(key),
    () => importView(key),
  );
  const [error, setError] = useState("");
  const [delivering, setDelivering] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    // Restore the original collection and immutable request before enabling a new search.
    void (async () => {
      const id =
        initialOtb?.collectionId ??
        (initialOtb?.requestKey || savedGeneralKey() === key
          ? await desktopApi.collectionCreate(initialOtb?.databaseName ?? "Opponent games", key)
          : null);
      if (id) {
        const c = await desktopApi.collectionGet(id);
        if (live && c.metadata.jobId) {
          setPlayerName(c.metadata.playerName!);
          setFideId(c.metadata.fideId!);
          setFromYear(c.metadata.fromYear!);
          setSources(c.metadata.sources!);
          restoreOpponentImport(key, c);
        }
      }
    })()
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setRecovering(false);
      });
    return () => {
      live = false;
      mounted.current = false;
    };
  }, [initialOtb?.collectionId, initialOtb?.databaseName, initialOtb?.requestKey, key]);
  async function useResult(result: OpponentImportResult) {
    setDelivering(true);
    setError("");
    try {
      await onDone(
        result.collectionId,
        `${result.gameCount} ${result.gameCount === 1 ? "game" : "games"} saved for ${result.playerName}.`,
        result,
      );
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setDelivering(false);
    }
  }
  async function start() {
    setError("");
    try {
      if (!initialOtb) localStorage.setItem(GENERAL_IMPORT_KEY, key);
      const result = await importOpponent({
        playerName,
        fideId,
        fromYear,
        sources,
        databaseName: initialOtb?.databaseName || playerName,
        collectionId: initialOtb?.collectionId,
        requestKey: key,
        refresh: true,
      });
      if (mounted.current && !result.cancelled && !result.warning) await useResult(result);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    }
  }
  const disabled = view.busy || delivering || recovering;
  const requestLocked = disabled || view.phase === "collect" || view.phase === "save";
  const total = view.progress?.overallTotal || view.progress?.total || 0;
  const current = view.progress?.overallCurrent ?? view.progress?.current ?? 0;
  return (
    <HomeModal title="Import opponent games" onClose={onClose} wide>
      <Stack gap="md">
        <Button variant="subtle" onClick={onClose} style={{ alignSelf: "flex-start" }}>
          Back to tournament
        </Button>
        {initialOtb?.lockIdentity ? (
          <Stack gap="xs">
            <TextInput label="Player" value={playerName} readOnly />
            <TextInput label="FIDE ID" value={fideId} readOnly />
            {!fideId && (
              <Alert color="yellow">
                No FIDE ID/profile is listed for this opponent. An exact import is unavailable.
              </Alert>
            )}
          </Stack>
        ) : (
          <FidePlayerSearchInput
            label="Player name or FIDE ID"
            value={playerName}
            selected={selected}
            disabled={requestLocked}
            mobileInline={!isNativeDesktop()}
            searchPlayers={isNativeDesktop() ? searchFidePlayers : searchWebFidePlayers}
            onChange={(value) => {
              setPlayerName(value);
              setFideId("");
              setSelected(null);
            }}
            onSelect={(player) => {
              setSelected(player);
              setPlayerName(player.name);
              setFideId(String(player.id));
              if (!yearEdited.current)
                setFromYear(getFideImportStartYear(player, new Date().getFullYear()));
            }}
          />
        )}
        {!initialOtb?.lockIdentity && fideId && (
          <Text size="sm" c="dimmed">
            FIDE {fideId}
          </Text>
        )}
        <NumberInput
          label="Games from year"
          min={1900}
          max={new Date().getFullYear()}
          value={fromYear}
          disabled={disabled || view.phase === "save" || view.phase === "collect"}
          onChange={(value) => {
            yearEdited.current = true;
            setFromYear(Number(value));
          }}
        />
        <details>
          <summary>Sources and local downloads</summary>
          <Stack gap="sm" mt="sm">
            {OTB_IMPORT_SOURCE_DETAILS.map((source) => (
              <Group key={source.key} gap="xs">
                <Checkbox
                  label={source.label}
                  checked={sources[source.key]}
                  disabled={requestLocked}
                  onChange={(event) =>
                    setSources({ ...sources, [source.key]: event.currentTarget.checked })
                  }
                />
                <HelpTip label={source.label}>{source.detail}</HelpTip>
              </Group>
            ))}
            <OtbDownloadControl
              fromYear={fromYear}
              sourceEnabled={sources.broadcastArchives}
              onEnableSource={() => setSources({ ...sources, broadcastArchives: true })}
            />
          </Stack>
        </details>
        {(view.message || recovering) && (
          <div role="status">
            <Text>{recovering ? "Checking saved import…" : view.message}</Text>
            {view.busy && (
              <Progress
                mt="xs"
                value={total ? Math.min(100, (current / total) * 100) : 0}
                animated={!total}
              />
            )}
            {view.progress && (
              <Text size="sm" c="dimmed">
                {view.progress.gamesFound} games found
                {total ? ` · ${current} of ${total} source steps` : ""}
              </Text>
            )}
          </div>
        )}
        {(error || view.error) && (
          <Alert color="red" title="Import needs attention">
            {error || view.error}
          </Alert>
        )}
        {view.result?.warning && (
          <Alert color="yellow" title="Some sources did not finish">
            {view.result.warning}
          </Alert>
        )}
        {view.result?.cancelled && (
          <Alert color="yellow">
            Search stopped. {view.result.gameCount} saved games are available.
          </Alert>
        )}
        <Group>
          {view.busy ? (
            <Button
              color="red"
              variant="light"
              disabled={view.phase === "save" || !view.jobId}
              onClick={() => void stopOpponentImport(key).catch((e) => setError(String(e)))}
            >
              Stop import
            </Button>
          ) : (
            <Button
              disabled={disabled || !fideId || !Object.values(sources).some(Boolean)}
              onClick={() => void start()}
            >
              {recovering
                ? "Checking…"
                : view.error
                  ? view.phase === "save"
                    ? "Retry saving games"
                    : "Retry import"
                  : view.result
                    ? "Check for more games"
                    : "Import & prep"}
            </Button>
          )}
          {view.result && (
            <Button
              variant="light"
              loading={delivering}
              onClick={() => void useResult(view.result!)}
            >
              {view.result.gameCount ? "Open Prep" : "Return to tournament"}
            </Button>
          )}
          {!initialOtb && view.result && (
            <Button
              variant="subtle"
              disabled={disabled}
              onClick={() => {
                localStorage.removeItem(GENERAL_IMPORT_KEY);
                setKey(`player-${crypto.randomUUID()}`);
                setPlayerName("");
                setFideId("");
                setSelected(null);
              }}
            >
              Import another player
            </Button>
          )}
        </Group>
      </Stack>
    </HomeModal>
  );
}
