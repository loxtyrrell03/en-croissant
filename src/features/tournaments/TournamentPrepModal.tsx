import { isValidTournamentTargetRound } from "./tournamentRoundMetadata";
import { normalizeTournamentResults } from "./normalizeTournamentResults";
import { useCallback, useEffect, useRef, useState } from "react";
import { pushToast } from "@/features/tournaments/ui";
import { confirmDialog } from "@/features/tournaments/ui";
import { PlayerGameImportModal, type OtbPlayerImportResult } from "@/features/tournaments/TournamentPlayerImport";
import { HomeModal } from "@/features/tournaments/ui";
import {
  desktopApi,
  isDesktop,
  type TournamentSnapshot,
  type TournamentPlayer,
} from "@/features/tournaments/platform";
import { TournamentDiscovery } from "./TournamentDiscovery";
import { TournamentEventPreview } from "./TournamentEventPreview";
import { selectTournamentEntry, matchTournamentImportOpponent } from "./tournamentRoster";
import { TournamentTrackerView, opponentReady, type OpponentAction } from "./TournamentTrackerView";
import {
  isChessResultsTournamentUrl,
} from "./tournamentFinder";
import {
  projectedSideFromHistory,
  type TournamentSide,
} from "./tournamentInsights";
import type { TournamentPrepHandoff } from "./tournamentPrepHandoff";
import {
  createTournamentPrepRecord,
  tournamentPlayerKey,
  loadTournamentPreps,
  saveTournamentPreps,
  tournamentPrepDatabaseIds,
  TOURNAMENT_PREP_UPDATED_EVENT,
  upsertTournamentPrep,
  type TournamentOpponentDatabase,
  type TournamentPrepMap,
} from "./tournamentPrepStore";
import {
  cancelTournamentPrepSync,
  stopFollowingTournament,
  isTournamentSyncRunning,
  latestTournamentSyncEvent,
  removeTournamentPrepAndDatabases,
  runTournamentPrepSync,
  subscribeTournamentSync,
  type TournamentSyncEvent,
  type TournamentSyncMode,
} from "./tournamentPrepSync";
import { usePairingForecast } from "./usePairingForecast";
import styles from "./TournamentPrepModal.module.css";

interface TournamentPrepModalProps {
  tournamentId?: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenDatabase: (collectionId: number) => void;
  onOpenPrep: (handoff: TournamentPrepHandoff) => void;
}

export function TournamentPrepModal({
  tournamentId,
  onClose,
  onChanged,
  onOpenDatabase,
  onOpenPrep,
}: TournamentPrepModalProps) {
  const currentYear = new Date().getFullYear();
  const [records, setRecords] = useState<TournamentPrepMap>({});
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(()=>{
    if(tournamentId)return tournamentId;
    try{return localStorage.getItem("encroissant.tournaments.last");}catch{return null;}
  });
  const [preview, setPreview] = useState<TournamentSnapshot | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const [fromYear, setFromYear] = useState(Math.max(2020, currentYear - 3));
  const [inspectBusy, setInspectBusy] = useState(false);
  const [syncEvent, setSyncEvent] = useState<TournamentSyncEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ opponent: TournamentOpponentDatabase; userSide: TournamentSide; action: OpponentAction } | null>(null);
  const mounted = useRef(true);
  const inspectSequence = useRef(0);
  const recordsSequence = useRef(0);
  const viewSequence = useRef(0);
  const [settingBusy, setSettingBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refreshRecords = useCallback(async () => {
    const sequence = ++recordsSequence.current;
    const loaded = await loadTournamentPreps();
    if (mounted.current && sequence === recordsSequence.current) {
      setRecords(loaded);
      setRecordsLoaded(true);
    }
  }, []);
  function navigateTo(id: string | null) {
    ++viewSequence.current;
    ++recordsSequence.current;
    setSelectedId(id);
    try{if(id)localStorage.setItem("encroissant.tournaments.last",id);else localStorage.removeItem("encroissant.tournaments.last");}catch{/* The tracker remains usable without local preferences. */}
    setError(null);
  }
  useEffect(() => {
    void refreshRecords();
    const onStoreUpdate = () => { void refreshRecords(); };
    globalThis.addEventListener(TOURNAMENT_PREP_UPDATED_EVENT, onStoreUpdate);
    setSyncEvent(selectedId ? latestTournamentSyncEvent(selectedId) : null);
    const unsubscribe = subscribeTournamentSync((event) => {
      if (event.tournamentId === selectedId) {
        setSyncEvent(event);
      }
    });
    return () => {
      ++recordsSequence.current;
      unsubscribe();
      globalThis.removeEventListener(TOURNAMENT_PREP_UPDATED_EVENT, onStoreUpdate);
    };
  }, [selectedId, tournamentId, refreshRecords]);

  const record = selectedId ? records[selectedId] : undefined;
  const { forecast, isCalculating: isCalculatingForecast } = usePairingForecast(
    record?.snapshot ?? null,
    record?.userStartNumber ?? null,
  );
  function cancelInspect() { inspectSequence.current++; setInspectBusy(false); }
  async function inspectTournament(sourceUrl: string) {
    if (!isDesktop() || !isChessResultsTournamentUrl(sourceUrl)) return;
    const sequence = ++inspectSequence.current;
    setInspectBusy(true); setError(null);
    try {
      const snapshot = await desktopApi.fetchTournamentSnapshot(sourceUrl);
      if (!mounted.current || sequence !== inspectSequence.current) return;
      setPreview(snapshot); setSelectedPlayer(null);
    } catch (caught) {
      if (mounted.current && sequence === inspectSequence.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mounted.current && sequence === inspectSequence.current) setInspectBusy(false);
    }
  }

  async function createTracker() {
    if (!preview || createBusy || inspectBusy) return;
    setCreateBusy(true);
    setError(null);
    try {
      const latest = await loadTournamentPreps();
      const existing = latest[preview.tournamentId];
      if (existing) {
        navigateTo(existing.id);
        return;
      }
      if (Object.keys(latest).length >= 24) throw new Error("You can follow up to 24 tournaments. Stop following an event before adding another.");
      const created = createTournamentPrepRecord(preview, selectedPlayer, Math.min(currentYear, Math.max(1900, fromYear || currentYear)));
      const next = upsertTournamentPrep(latest, created);
      await saveTournamentPreps(next);
      await refreshRecords();
      if (!mounted.current) return;
      navigateTo(created.id);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreateBusy(false);
    }
  }

  async function startSync(mode: TournamentSyncMode) {
    if (!record) return;
    const owner = viewSequence.current;
    setError(null);
    try {
      await runTournamentPrepSync(record.id, mode);
      if (!mounted.current || owner !== viewSequence.current) return;
      await refreshRecords();
      if (mounted.current && owner === viewSequence.current) onChanged();
    } catch (caught) {
      if (mounted.current && owner === viewSequence.current) setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function toggleAutoUpdate() {
    if (!record || settingBusy) return;
    setSettingBusy(true); setError(null);
    try {
      const latest = await loadTournamentPreps();
      const current = latest[record.id];
      if (!current) throw new Error("This tournament tracker is no longer available.");
      const next = upsertTournamentPrep(latest, { ...current, autoUpdate: !current.autoUpdate });
      await saveTournamentPreps(next);
      if (mounted.current) await refreshRecords();
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally { if (mounted.current) setSettingBusy(false); }
  }

  async function stopTracking() {
    if (!record) return;
    const databaseCount = tournamentPrepDatabaseIds(record).length;
    const confirmed = await confirmDialog({
      title: "Stop tracking and delete databases?",
      message:
        databaseCount > 0
          ? `This stops automatic checks and permanently deletes ${databaseCount} opponent database${databaseCount === 1 ? "" : "s"} and all of their games.`
          : "This removes the tracker and stops automatic checks.",
      confirmLabel: databaseCount > 0 ? "Stop and delete" : "Stop tracking",
      tone: "danger",
    });
    if (!confirmed) return;
    setRemoveBusy(true);
    setError(null);
    try {
      const result = await removeTournamentPrepAndDatabases(record.id);
      pushToast({
        tone: "success",
        message: "Tournament tracking stopped",
        detail:
          result.databasesDeleted > 0
            ? `${result.databasesDeleted} opponent database${result.databasesDeleted === 1 ? "" : "s"} deleted.`
            : `${record.title} was removed from tournament prep.`,
      });
      if (!mounted.current) return;
      navigateTo(null);
      onChanged();
      onClose();
    } catch (caught) {
      setError(`The tournament was not removed. ${caught instanceof Error ? caught.message : String(caught)}`);
      await refreshRecords();
    } finally {
      setRemoveBusy(false);
    }
  }

  function projectedSideFor(startNumber: number): TournamentSide {
    if (!record || record.userStartNumber === null) return "white";
    const forecastSide = forecast?.candidates.find(
      (candidate) => candidate.player.startNumber === startNumber,
    )?.color;
    if (forecastSide) return forecastSide;
    const snapshot = normalizeTournamentResults(record.snapshot);
    const targetRound = snapshot.nextRound;
    const directPairing = isValidTournamentTargetRound(snapshot, targetRound) ? snapshot.pairings.find(
      (pairing) =>
        pairing.round === targetRound &&
        ((pairing.whiteStartNumber === record.userStartNumber && pairing.blackStartNumber === startNumber) ||
          (pairing.blackStartNumber === record.userStartNumber && pairing.whiteStartNumber === startNumber)),
    ) : undefined;
    if (directPairing?.whiteStartNumber === record.userStartNumber) return "white";
    if (directPairing?.blackStartNumber === record.userStartNumber) return "black";
    return projectedSideFromHistory(snapshot, record.userStartNumber);
  }

  function openPreparedOpponent(opponent: TournamentOpponentDatabase, userSide: TournamentSide) {
    if (!record || !opponent.collectionId) return;
    onOpenPrep({
      collectionId: opponent.collectionId,
      playerName: opponent.name,
      userSide,
      tournamentTitle: record.title,
    });
  }

  async function startOpponentPrep(opponent: TournamentOpponentDatabase, userSide: TournamentSide, action: OpponentAction = "prep") {
    if (!record || isTournamentSyncRunning(record.id)) return;
    const player = record.snapshot.players.find(player => player.startNumber === opponent.startNumber);
    if (!player || player.name !== opponent.name || (opponent.fideId && player.fideId !== opponent.fideId)) {
      setError("This opponent’s entry has changed. Check the tournament before importing.");
      return;
    }
    if (opponentReady(opponent)) {
      if (action === "prep") openPreparedOpponent(opponent, userSide);
      else onOpenDatabase(opponent.collectionId!);
      return;
    }
    if (!player.fideId || !/^[1-9]\d*$/.test(player.fideId)) {
      setError(`${player.name}: No FIDE ID/profile is listed for this opponent. An exact FIDE import is unavailable.`);
      return;
    }
    setError(null);
    setPendingImport({ opponent: { ...opponent, name: player.name, fideId: player.fideId }, userSide, action });
  }

  async function finishOpponentImport(collectionId: number, message: string, result?: OtbPlayerImportResult) {
    if (!record || !pendingImport || !result) throw new Error("The tournament import context is no longer available.");
    const before = (await loadTournamentPreps())[record.id];
    if (!before) throw new Error("This tracker was removed. Imported games are still available in your Library.");
    matchTournamentImportOpponent(before, pendingImport.opponent, result);
    await desktopApi.collectionSetFolder(collectionId, before.folder);
    // A refresh or unfollow may finish during the folder operation.
    // Re-match against current state before attaching the imported games.
    const latest = await loadTournamentPreps();
    const current = latest[record.id];
    if (!current) throw new Error("This tracker was removed. Imported games are still available in your Library.");
    const matched = matchTournamentImportOpponent(current, pendingImport.opponent, result);
    const updated = { ...matched, collectionId, status: result.gameCount > 0 ? "ready" as const : "no-games" as const, gameCount: result.gameCount, importFromYear: result.fromYear, lastSyncAt: new Date().toISOString(), error: null };
    const next = upsertTournamentPrep(latest, { ...current, opponents: { ...current.opponents, [String(matched.startNumber)]: updated } });
    await saveTournamentPreps(next);
    if (!mounted.current) return;
    await refreshRecords();
    if (!mounted.current) return;
    setPendingImport(null); onChanged();
    pushToast({ tone: result.gameCount > 0 ? "success" : "info", message: result.gameCount > 0 ? "Opponent database ready" : "No public games found", detail: message });
    if (pendingImport.action === "prep" && !result.cancelled && result.gameCount > 0) openPreparedOpponent(updated, pendingImport.userSide);
  }

  async function chooseEntry(player: TournamentPlayer | null) {
    if (!record || settingBusy) return;
    setSettingBusy(true); setError(null);
    try {
      const latest = await loadTournamentPreps();
      if (!latest[record.id]) throw new Error("This tracker is no longer available.");
      const next = upsertTournamentPrep(latest, selectTournamentEntry(latest[record.id], player));
      await saveTournamentPreps(next); if (mounted.current) await refreshRecords();
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (mounted.current) setSettingBusy(false); }
  }
  async function markReviewed() {
    if (!record || settingBusy) return;
    setSettingBusy(true); setError(null);
    try {
      const latest = await loadTournamentPreps();
      const current = latest[record.id];
      if (!current) return;
      const next = upsertTournamentPrep(latest, {...current, seenPlayerKeys:current.snapshot.players.map(tournamentPlayerKey)});
      await saveTournamentPreps(next); if (mounted.current) await refreshRecords();
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (mounted.current) setSettingBusy(false); }
  }
  async function unfollow() {
    if (!record || removeBusy) return;
    if (!await confirmDialog({title:"Stop following?",message:"Entry and pairing checks will stop. Your imported games will be kept.",confirmLabel:"Stop following"})) return;
    setRemoveBusy(true); setError(null);
    try {
      await stopFollowingTournament(record.id); await refreshRecords();
      if (!mounted.current) return;
      navigateTo(null); setPreview(null); onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setRemoveBusy(false); }
  }

  if (record && pendingImport) {
    return <PlayerGameImportModal
      initialOtb={{ playerName: pendingImport.opponent.name, fideId: pendingImport.opponent.fideId,
        requestKey: `tournament-${record.id}-fide-${pendingImport.opponent.fideId}`, fromYear: record.fromYear, databaseName: pendingImport.opponent.name, collectionId: pendingImport.opponent.collectionId, lockIdentity: true }}
      onClose={() => setPendingImport(null)} onDone={finishOpponentImport} />;
  }

  if (tournamentId && !recordsLoaded) {
    return (
      <HomeModal title="Tournament tracking" onClose={onClose} wide>
        <div className={styles.loadingState} role="status">Loading tournament…</div>
      </HomeModal>
    );
  }

  if (!record) {
    return <HomeModal title="Tournaments" onClose={onClose} workspace tall>
      {preview ? <TournamentEventPreview snapshot={preview} selectedPlayer={selectedPlayer} onSelectPlayer={setSelectedPlayer}
        fromYear={fromYear} onYear={setFromYear} onSection={url => void inspectTournament(url)}
        onBack={() => { cancelInspect(); setPreview(null); setError(null); }} onFollow={() => void createTracker()}
        busy={inspectBusy} saving={createBusy} error={error} /> :
        <TournamentDiscovery records={records} onInspect={url => void inspectTournament(url)} onOpen={id => {cancelInspect(); navigateTo(id);}}
          busy={inspectBusy} onCancel={cancelInspect} error={error} />}
    </HomeModal>;
  }

  return (
    <HomeModal title="Tournament" onClose={onClose} workspace tall>
      <TournamentTrackerView key={record.id} record={record} forecast={forecast}
        calculating={isCalculatingForecast} running={isTournamentSyncRunning(record.id)}
        prepBusy={null} removeBusy={removeBusy} settingBusy={settingBusy} syncEvent={syncEvent} error={error}
        projectedSideFor={projectedSideFor} onOpponent={startOpponentPrep} onOpenDatabase={onOpenDatabase}
        onToggleUpdate={toggleAutoUpdate} onCheck={() => startSync("roster")}
        onStop={() => cancelTournamentPrepSync(record.id)} onRemove={stopTracking}
        onBack={() => {navigateTo(null); setPreview(null); setError(null);}} onChooseEntry={chooseEntry} onReviewed={markReviewed} onUnfollow={unfollow} />
    </HomeModal>
  );
}
