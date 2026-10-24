import { useEffect, useMemo, useState } from "react";
import type { TournamentPlayer } from "@/features/tournaments/platform";
import { HelpTip } from "@/features/tournaments/ui";
import type { TournamentPrepRecord } from "./tournamentPrepStore";
import { formatForecastPercent, type PairingForecast } from "./pairingForecast";
import { forecastHeading } from "./forecastPresentation";
import { usePairingForecast } from "./usePairingForecast";
import { emptyPredictionHistory, comparePrediction, playerPredictionRounds, predictionToSave, publishedOpponent, type PredictionHistory, type PredictionRound, type SavedPrediction } from "./predictionHistory";
import { PREDICTION_HISTORY_UPDATED, updatePredictionHistory } from "./predictionHistoryStore";
import styles from "./TournamentPredictions.module.css";

function useSavedPredictions(record: TournamentPrepRecord, player: TournamentPlayer | null, forecast: PairingForecast | null, calculating: boolean) {
  const [state, setState] = useState<{ id: string; history: PredictionHistory; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const capture = useMemo(() => predictionToSave(record.snapshot, player, forecast, calculating,
    record.manualResults?.filter(r => forecast?.round && r.round < forecast.round).length ?? 0), [record.snapshot, record.manualResults, player, forecast, calculating]);
  useEffect(() => {
    const update = (event: Event) => { if ((event as CustomEvent).detail === record.id) setRetry(n => n+1); };
    globalThis.addEventListener(PREDICTION_HISTORY_UPDATED, update);
    return () => globalThis.removeEventListener(PREDICTION_HISTORY_UPDATED, update);
  }, [record.id]);
  useEffect(() => {
    let active = true;
    void updatePredictionHistory(record.id, record.snapshot, capture && player && forecast?.round ? { player, round: forecast.round, prediction: capture } : undefined)
      .then(history => { if (active) setState({ id: record.id, history, error: null }); })
      .catch(error => { if (active) setState(previous => ({ id: record.id, history: previous?.id === record.id ? previous.history : emptyPredictionHistory(record.id), error: error instanceof Error ? error.message : "Prediction history could not be saved." })); });
    return () => { active = false; };
  }, [record.id, record.snapshot, player, forecast?.round, capture, retry]);
  return { history: state?.id === record.id ? state.history : emptyPredictionHistory(record.id),
    loading: state?.id !== record.id, error: state?.id === record.id ? state.error : null, retry: () => setRetry(n => n+1) };
}

const colour = (value: "white" | "black" | null) => value === "white" ? "White" : value === "black" ? "Black" : "Colour unknown";
const chance = (value: number | null) => value === null ? "Chance unknown" : `${formatForecastPercent(value)} chance`;
const ordinal = (rank: number) => rank === 1 ? "First choice" : rank === 2 ? "2nd choice" : rank === 3 ? "3rd choice" : `${rank}th choice`;
function SaveError({ error, retry }: { error: string | null; retry: () => void }) {
  return error ? <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={retry}>Retry save</button></div> : null;
}
function Comparison({ record, player, round, prediction, corrected = false }: { record: TournamentPrepRecord; player: TournamentPlayer; round: number; prediction?: SavedPrediction; corrected?: boolean }) {
  const actual = publishedOpponent(record.snapshot, player, round);
  const { rank, candidate } = comparePrediction(prediction, actual);
  return <section className={styles.comparison} aria-label={`Round ${round} prediction comparison`}>
    <h4>Round {round} · Prediction vs pairing</h4>
    <div className={styles.pair}>
      <div><span>Predicted</span><strong>{prediction?.candidates[0]?.player.name ?? "No saved prediction"}</strong>{prediction?.candidates[0] && <span>{chance(prediction.candidates[0].probability)}</span>}</div>
      <div><span>Actual</span><strong>{actual?.label ?? "Pairing not available"}</strong>{actual?.player && <span>{colour(actual.color)}</span>}</div>
    </div>
    {prediction && actual && <p className={styles.verdict}>{actual.player ? rank ? `${ordinal(rank)} · ${chance(candidate!.probability)}` : "Outside saved shortlist" : "No opponent this round"}
      {candidate && <span>{candidate.color && actual.color ? candidate.color === actual.color ? "Colour matched" : `Colour: predicted ${colour(candidate.color)}, actual ${colour(actual.color)}` : "Colour comparison unavailable"}</span>}
    </p>}
    {corrected && actual && <p className={styles.changed}>Official pairing changed</p>}
  </section>;
}

export function TournamentPredictionSummary({ record, forecast, calculating, onHistory, visible = true }: { record: TournamentPrepRecord; forecast: PairingForecast | null; calculating: boolean; onHistory: () => void; visible?: boolean }) {
  const player = record.snapshot.players.find(p => p.startNumber === record.userStartNumber) ?? null;
  const saved = useSavedPredictions(record, player, forecast, calculating);
  const round = Math.min(128, record.snapshot.publishedRound);
  const row = player ? playerPredictionRounds(saved.history, record.snapshot, player).find(r => r.round === round) : undefined;
  if (!visible) return null;
  return <div className={styles.root}>
    <SaveError error={saved.error} retry={saved.retry}/>
    {player && round > 0 && publishedOpponent(record.snapshot, player, round) && !saved.loading && <Comparison record={record} player={player} round={round} prediction={row?.versions.at(-1)} corrected={row?.corrected}/>}
    {player && <button type="button" className={styles.link} onClick={onHistory}>My past predictions →</button>}
  </div>;
}

export function PlayerPredictions({ record, player, initialView = "next", onPlayer }: { record: TournamentPrepRecord; player: TournamentPlayer; initialView?: "next" | "past"; onPlayer: (player: TournamentPlayer) => void }) {
  const [cancelled, setCancelled] = useState(false);
  const { forecast, isCalculating } = usePairingForecast(cancelled ? null : record.snapshot, player.startNumber, record.manualResults);
  const saved = useSavedPredictions(record, player, forecast, isCalculating);
  const [view, setView] = useState(initialView);
  const [chosenRound, setChosenRound] = useState<number | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const rounds = playerPredictionRounds(saved.history, record.snapshot, player);
  const latest = Math.min(128, Math.max(record.snapshot.publishedRound, record.snapshot.completedRound));
  const round = Math.min(chosenRound ?? latest, latest);
  const row = rounds.find(r => r.round === round);
  const prediction = row?.versions.find(v => v.capturedAt === version) ?? row?.versions.at(-1);
  const publishedRound = Math.min(128, record.snapshot.publishedRound);
  const publishedRow = rounds.find(r => r.round === publishedRound);
  const heading = forecastHeading(forecast, record.snapshot.publishedRound === 0);
  return <section className={styles.root} aria-label={`Predictions for ${player.name}`}>
    <div className={styles.switcher} role="group" aria-label="Player predictions">
      <button type="button" aria-pressed={view === "next"} onClick={() => setView("next")}>Next round</button>
      <button type="button" aria-pressed={view === "past"} onClick={() => setView("past")}>Past predictions</button>
    </div>
    <SaveError error={saved.error} retry={saved.retry}/>
    {view === "next" ? <>
      {publishedRound > 0 && publishedOpponent(record.snapshot, player, publishedRound) && !saved.loading && <Comparison record={record} player={player} round={publishedRound} prediction={publishedRow?.versions.at(-1)} corrected={publishedRow?.corrected}/>}
      <h4>{heading}<HelpTip label="Predicted opponents">Estimates of who this player will face, not their chance of winning. Only official pairings confirm the opponent.</HelpTip></h4>
      {isCalculating ? <p role="status">Calculating… <button type="button" onClick={() => setCancelled(true)}>Cancel</button></p> : cancelled ? <p>Calculation stopped. <button type="button" onClick={() => setCancelled(false)}>Calculate</button></p> : forecast?.candidates.length ? <div className={styles.opponents}>
        {forecast.candidates.map(candidate => <div className={styles.opponent} key={candidate.player.startNumber}>
          <button type="button" className={styles.link} onClick={() => onPlayer(candidate.player)}>{candidate.player.name}</button>
          <strong>{forecast.kind === "confirmed" ? "Published" : forecast.kind === "scheduled" ? "Scheduled" : forecast.kind === "inferred" ? "Expected" : formatForecastPercent(candidate.probability)}</strong>
          <span>{colour(candidate.color)}</span>
        </div>)}
        {forecast.kind === "estimated" && forecast.otherProbability !== null && forecast.otherProbability > 0 && <p className={styles.other}>Other opponents or no game: {formatForecastPercent(forecast.otherProbability)}</p>}
      </div> : forecast?.summary === heading ? null : <p>{forecast?.summary ?? "No prediction available yet."}</p>}
    </> : saved.loading ? <p role="status">Loading predictions…</p> : latest < 1 ? <p>No past rounds yet.</p> : <>
      <label className={styles.round}>Round<select aria-label="Prediction round" value={round} onChange={e => { setChosenRound(Number(e.target.value)); setVersion(null); }}>{Array.from({ length: latest }, (_,i) => latest-i).map(n => <option key={n} value={n}>Round {n}</option>)}</select></label>
      <Comparison record={record} player={player} round={round} prediction={prediction} corrected={row?.corrected}/>
      {prediction && <SavedShortlist row={row!} prediction={prediction} actual={publishedOpponent(record.snapshot, player, round)?.player ?? null} onVersion={setVersion}/>}
    </>}
  </section>;
}

function SavedShortlist({ row, prediction, actual, onVersion }: { row: PredictionRound; prediction: SavedPrediction; actual: TournamentPlayer | { name: string; fideId: string | null } | null; onVersion: (value: string) => void }) {
  const match = comparePrediction(prediction, actual ? { player: actual, label: actual.name, color: null } : null).rank;
  return <details className={styles.shortlist}><summary>Saved prediction<HelpTip label="Saved predictions">Saved before this app saw the pairings. The first and two latest forecasts are kept. History is stored in this app on this device.</HelpTip></summary>
    {row.versions.length > 1 && <label>Saved at<select aria-label="Saved prediction time" value={prediction.capturedAt} onChange={e => onVersion(e.target.value)}>{row.versions.map(v => <option key={v.capturedAt} value={v.capturedAt}>{new Date(v.capturedAt).toLocaleString()}</option>)}</select></label>}
    <div className={styles.opponents}>{prediction.candidates.map((candidate,i) => <div className={styles.opponent} data-actual={i+1 === match || undefined} key={i}><span>{candidate.player.name}{i+1 === match && <strong className={styles.actual}>Actual</strong>}</span><strong>{formatForecastPercent(candidate.probability)}</strong><span>{colour(candidate.color)}</span></div>)}</div>
    {prediction.manualResults > 0 && <p>Used {prediction.manualResults} manual {prediction.manualResults === 1 ? "result" : "results"}.</p>}
  </details>;
}
