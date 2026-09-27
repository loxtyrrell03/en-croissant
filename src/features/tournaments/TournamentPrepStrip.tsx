import { pairingEstimateHelp } from "./pairingScoreHelp";
import { TournamentStartCountdown } from "./TournamentStartCountdown";
import { useEffect, useMemo, useRef, useState } from "react";
import { pushToast } from "@/features/tournaments/ui";
import { confirmDialog } from "@/features/tournaments/ui";
import { HelpTip } from "@/features/tournaments/ui";
import { formatForecastPercent, tournamentPhaseLabel } from "./pairingForecast";
import {
  loadLocalTournamentPreps,
  loadTournamentPreps,
  TOURNAMENT_PREP_UPDATED_EVENT,
  type TournamentPrepMap,
  type TournamentPrepRecord,
} from "./tournamentPrepStore";
import {
  isTournamentSyncRunning,
  stopFollowingTournament,
  subscribeTournamentSync,
} from "./tournamentPrepSync";
import { usePairingForecast } from "./usePairingForecast";
import styles from "./TournamentPrepStrip.module.css";

function TournamentPrepRow({
  record,
  syncing,
  removing,
  stopDisabled,
  onOpen,
  onRemove,
}: {
  record: TournamentPrepRecord;
  syncing: boolean;
  removing: boolean;
  stopDisabled: boolean;
  onOpen: (tournamentId: string) => void;
  onRemove: (record: TournamentPrepRecord) => void;
}) {
  const { forecast, isCalculating } = usePairingForecast(
    record.snapshot,
    record.userStartNumber,
  );
  const top = forecast?.candidates[0];
  const eventDetails = [
    record.snapshot.section ? `${record.snapshot.section} section` : null,
    tournamentPhaseLabel(record.snapshot),
  ]
    .filter(Boolean)
    .join(" · ");
  const round = forecast?.round ? `Round ${forecast.round}` : "Next round";
  const pairingStatus = top && forecast
    ? forecast.kind === "inferred" ? "Expected (Berger)" : forecast.kind === "confirmed" || forecast.kind === "scheduled"
      ? forecast.kind === "confirmed" ? "Published pairing" : "Scheduled pairing"
      : `${formatForecastPercent(top.probability)} pairing chance${isCalculating ? " · updating" : ""}`
    : null;

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.openButton}
        disabled={removing}
        aria-label={`Open tournament preparation for ${record.title}`}
        onClick={() => onOpen(record.id)}
      >
        <span className={styles.event}>
          <strong>{record.title}</strong>
          <small>{eventDetails}</small>
          <TournamentStartCountdown info={record.snapshot} compact/>
        </span>
      </button>
        <div className={styles.detail}>
          <span className={styles.label}>Next opponent<HelpTip label={`Pairing for ${record.title}`}>{pairingEstimateHelp(record.snapshot, forecast) ?? "How likely you are to play this person next round, not your chance of winning. Confirmed pairings are labelled Published or Scheduled."}</HelpTip></span>
          <strong>{top?.player.name ?? forecast?.summary ?? (record.snapshot.players.length ? `${record.snapshot.players.length} published players` : "Waiting for entries")}</strong>
          <small>{pairingStatus ? `${round} · ${pairingStatus}` : record.snapshot.phase === "registration" ? "Pairings not published" : round}</small>
        </div>
      <div className={styles.rowActions}>
      <button type="button" className={styles.openTracker} disabled={removing} onClick={() => onOpen(record.id)}>Open tracker</button>
      {syncing && <small className={styles.syncState} role="status">Checking tournament…</small>}
      <button
        type="button"
        className={styles.stopButton}
        disabled={stopDisabled}
        aria-label={`Stop following ${record.title}`}
        onClick={() => onRemove(record)}
      >
        {removing ? "Stopping…" : "Stop following"}
      </button>
      </div>
    </div>
  );
}

export function TournamentPrepStrip({
  onOpen,
  onNew,
}: {
  onOpen: (tournamentId: string) => void;
  onNew: () => void;
}) {
  const [records, setRecords] = useState<TournamentPrepMap>(() => loadLocalTournamentPreps());
  const [revision, setRevision] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRequest = useRef(0);
  const removeActive = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      const owner = ++loadRequest.current;
      setLoading(true);
      void loadTournamentPreps().then((loaded) => {
        if (!cancelled && owner === loadRequest.current) setRecords(loaded);
      }).finally(() => { if (!cancelled && owner === loadRequest.current) setLoading(false); });
    };
    refresh();
    const onStoreUpdate = () => refresh();
    globalThis.addEventListener(TOURNAMENT_PREP_UPDATED_EVENT, onStoreUpdate);
    const unsubscribe = subscribeTournamentSync(() => setRevision((value) => value + 1));
    return () => {
      cancelled = true;
      ++loadRequest.current;
      unsubscribe();
      globalThis.removeEventListener(TOURNAMENT_PREP_UPDATED_EVENT, onStoreUpdate);
    };
  }, []);

  const rows = useMemo(
    () =>
      Object.values(records)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => ({
          record,
          syncing: isTournamentSyncRunning(record.id),
        })),
    // Sync events advance revision so the live pulse updates even before the
    // persisted record changes.
    [records, removingId, revision],
  );
  async function stopTracking(record: TournamentPrepRecord) {
    if (removeActive.current) return;
    removeActive.current = true;
    const confirmed = await confirmDialog({
      title: "Stop following?",
      message: "Entry and pairing checks will stop. Your imported games will be kept.",
      confirmLabel: "Stop following",
    });
    if (!confirmed) { removeActive.current = false; return; }
    setRemovingId(record.id);
    try {
      await stopFollowingTournament(record.id);
      const owner = ++loadRequest.current;
      const latest = await loadTournamentPreps();
      if (owner === loadRequest.current) { setRecords(latest); setLoading(false); }
      pushToast({ tone: "success", message: "Stopped following tournament" });
    } catch (caught) {
      pushToast({
        tone: "error",
        message: "Could not stop following tournament",
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      removeActive.current = false;
      setRemovingId(null);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="tracked-tournaments-title">
      <div className={styles.header}>
        <h2 id="tracked-tournaments-title">Tournament preparation</h2>
        <div className={styles.headerActions}>
          <button type="button" className={styles.primaryAction} onClick={onNew}>
            Find tournaments
          </button>
        </div>
      </div>
      {rows.length > 0 && (
        <div className={styles.list}>
          {rows.map(({ record, syncing }) => (
            <TournamentPrepRow
              key={record.id}
              record={record}
              syncing={syncing}
              removing={removingId === record.id}
              stopDisabled={removingId !== null}
              onOpen={onOpen}
              onRemove={(item) => void stopTracking(item)}
            />
          ))}
        </div>
      )}
      {rows.length === 0 && <p className={styles.empty} role={loading ? "status" : undefined}>{loading ? "Loading followed tournaments…" : "No followed tournaments."}</p>}
    </section>
  );
}
