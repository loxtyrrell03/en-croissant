import { pairingEstimateHelp } from "./pairingScoreHelp";
import { forecastHeading, precedingResultContext, tournamentResultLabel } from "./forecastPresentation";
import { tournamentCountdown } from "./tournamentStart";
import { TournamentStartCountdown } from "./TournamentStartCountdown";
import { TournamentWebsiteLink } from "./TournamentWebsiteLink";
import { useEffect, useState, type KeyboardEvent } from "react";
import { HelpTip } from "@/features/tournaments/ui";
import type { TournamentPlayer } from "@/features/tournaments/platform";
import { formatForecastPercent, tournamentPhaseLabel, type PairingForecast } from "./pairingForecast";
import { standingsAfterRound, roundPairings, tournamentPlayerStats, type TournamentSide } from "./tournamentInsights";
import { tournamentPlayerKey, tournamentPrepDatabaseIds, type TournamentPrepRecord, type TournamentOpponentDatabase } from "./tournamentPrepStore";
import { reconcileTournamentIdentity } from "./tournamentRoster";
import type { TournamentSyncEvent } from "./tournamentPrepSync";
import styles from "./TournamentTrackerView.module.css";

export type OpponentAction = "import" | "prep";
export function importErrorHelp(message: string): string {
  if (/429|too many requests|rate.limit/i.test(message)) return "The games website has asked us to slow down. Wait a few minutes and try again.";
  if (/timed? out|timeout/i.test(message)) return "The import took too long to respond. Try again.";
  if (/disk.*full|not enough (?:free )?space|no space left/i.test(message)) return "There is not enough free space to save the games. Free some space and try again.";
  if (/401|403|forbidden|unauthori[sz]ed/i.test(message)) return "The games website refused access. Try again later.";
  if (/network|dns|failed to fetch|connection (?:reset|refused)/i.test(message)) return "Could not connect to the games website. Check your internet connection and try again.";
  if (/<!doctype|<html/i.test(message)) return "The website returned a page instead of games. Try again later.";
  // Keep an unfamiliar reported cause rather than guess or hide it.
  return message;
}
export function opponentReady(opponent: TournamentOpponentDatabase): boolean {
  return opponent.collectionId !== null && opponent.status === "ready" && opponent.gameCount > 0;
}
export function opponentGameLabel(opponent: TournamentOpponentDatabase): string {
  switch (opponent.status) {
    case "ready": return opponent.gameCount > 0 ? `${opponent.gameCount.toLocaleString()} ${opponent.gameCount===1?"game":"games"} ready` : "No public games";
    case "no-games": return "No public games";
    case "searching": return "Searching sources…";
    case "queued": return "Queued";
    case "error": return "Import failed";
    default: return "Not imported";
  }
}
const help = {
  chance: "How likely you are to play this opponent next round. This is an estimate, not a confirmed pairing or a chance of winning.",
  colour: "The colour you are expected to play. It is confirmed only when the organiser publishes the pairing.",
  games: "This opponent’s saved games from in-person tournaments. No public games means the search finished but found none.",
  actions: "Import & prep finds this player’s games and opens them for preparation. Open Prep uses games already saved.",
  points: "A win is 1 point, a draw ½, and a loss 0. Includes any points awarded without playing a game.",
  rating: "The player's rating listed for this event.",
  rank: "The place published by the organiser after this round, including how they separate players on equal points.",
  order: "An order based on points and ratings. The organiser’s order for players on equal points is unavailable.",
  form: "W means win, D means draw, L means loss. Oldest games come first.",
};
type Tab = "next" | "standings" | "results" | "players" | "tracking";
const tabs: [Tab, string][] = [["next", "Next round"], ["players", "Players"], ["standings", "Standings"], ["results", "Results"], ["tracking", "Tracking"]];
interface Props {
  record: TournamentPrepRecord;
  forecast: PairingForecast | null;
  calculating: boolean;
  running: boolean;
  prepBusy: number | null;
  removeBusy: boolean;
  settingBusy: boolean;
  syncEvent: TournamentSyncEvent | null;
  error: string | null;
  projectedSideFor: (startNumber: number) => TournamentSide;
  onOpponent: (opponent: TournamentOpponentDatabase, side: TournamentSide, action: OpponentAction) => Promise<void>;
  onOpenDatabase: (id: number) => void;
  onToggleUpdate: () => Promise<void>;
  onCheck: () => Promise<void>;
  onStop: () => Promise<unknown>;
  onRemove: () => Promise<void>;
  onBack?: () => void;
  onChooseEntry?: (player: TournamentPlayer | null) => Promise<void>;
  onReviewed?: () => Promise<void>;
  onUnfollow?: () => Promise<void>;
}

export function TournamentTrackerView(props: Props) {
  const { record, forecast, calculating, running, prepBusy, removeBusy, settingBusy, syncEvent, error } = props;
  const { snapshot } = record;
  const beforePlay = snapshot.publishedRound === 0 && snapshot.completedRound === 0;
  const countdown = tournamentCountdown(snapshot, Date.now());
  const dates = snapshot.dateRange?.split(" to ");
  const dateInCountdown = !!countdown?.dateTime && countdown.dateTime.slice(0, 10) === dates?.[0]?.replaceAll("/", "-");
  const eventDates = dateInCountdown ? (dates?.[1] ? `Ends ${dates[1]}` : null) : snapshot.dateRange;
  const [tab, setTab] = useState<Tab>(record.userStartNumber === null ? "players" : "next");
  const [newOnly, setNewOnly] = useState(false);
  const seen = new Set(record.seenPlayerKeys ?? snapshot.players.map(tournamentPlayerKey));
  const newPlayers = snapshot.players.filter(player => !seen.has(tournamentPlayerKey(player)));
  const [round, setRound] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [inspected, setInspected] = useState<{ player: TournamentPlayer; roster: TournamentPlayer[] } | null>(null);
  const [side, setSide] = useState<TournamentSide>("white");
  const maxRound = Math.max(1, snapshot.publishedRound, snapshot.completedRound);
  const activeRound = Math.min(maxRound, Math.max(1, round ?? snapshot.liveRound ?? (snapshot.completedRound || maxRound)));
  const standings = standingsAfterRound(snapshot, activeRound);
  const published = Boolean(snapshot.roundStandings?.some(row => row.round === activeRound && row.players.length) ||
    (activeRound === snapshot.completedRound && snapshot.players.some(player => player.rank !== null)));
  const yourRound = snapshot.completedRound || 0;
  const yourStandings = standingsAfterRound(snapshot, yourRound);
  const you = yourStandings.find(player => player.startNumber === record.userStartNumber);
  const yourRankPublished = Boolean(snapshot.roundStandings?.some(row => row.round === yourRound && row.players.length) ||
    (yourRound === snapshot.completedRound && snapshot.players.some(player => player.rank !== null)));
  const busy = running || prepBusy !== null || removeBusy;
  const prepDisabled = busy || snapshot.format === "team";
  const selected = inspected ? inspected.roster === snapshot.players
    ? snapshot.players.find(player => player.startNumber === inspected.player.startNumber && player.name === inspected.player.name && player.fideId === inspected.player.fideId)
    : reconcileTournamentIdentity(inspected.roster, snapshot.players, inspected.player) : null;
  // Remember newly published identity information for subsequent refreshes,
  // retaining the user's preparation colour for this same person.
  useEffect(() => {
    if (selected && inspected && inspected.roster !== snapshot.players) setInspected({ player: selected, roster: snapshot.players });
  }, [selected, inspected, snapshot.players]);
  const selectedStanding = selected ? standings.find(player => player.startNumber === selected.startNumber) : null;
  const opponent = selected ? record.opponents[String(selected.startNumber)] : null;
  const stats = selected ? tournamentPlayerStats(snapshot, selected.startNumber, activeRound) : null;
  const players = new Map(snapshot.players.map(player => [player.startNumber, player]));
  const needle = query.trim().toLocaleLowerCase();
  const visible = (tab === "players" ? snapshot.players : standings).filter(player => (tab !== "players" || !newOnly || !seen.has(tournamentPlayerKey(player))) && (!needle || `${player.name} ${player.fideId ?? ""} ${player.federation ?? ""}`.toLocaleLowerCase().includes(needle)));
  const visibleStandings = standings.filter(player => !needle || `${player.name} ${player.fideId ?? ""} ${player.federation ?? ""}`.toLocaleLowerCase().includes(needle));
  const readyCount = Object.values(record.opponents).filter(o => o.status === "ready" && o.gameCount > 0 && o.collectionId !== null).length;
  const emptyCount = Object.values(record.opponents).filter(o => o.status === "no-games" || (o.status === "ready" && o.gameCount === 0)).length;
  const inferred = forecast?.kind === "inferred";
  const fixed = inferred || forecast?.kind === "confirmed" || forecast?.kind === "scheduled";
  const resultContext = precedingResultContext(snapshot, forecast);
  const publishedColour = forecast?.kind === "confirmed" || forecast?.kind === "scheduled";
  const colourLabel = publishedColour ? "Your colour" : "Expected colour";
  const currentSyncEvent = syncEvent?.tournamentId === record.id ? syncEvent : null;
  const checkError = !running && currentSyncEvent?.phase === "error" ? currentSyncEvent.message : null;
  function inspect(player: TournamentPlayer) { setInspected({player, roster:snapshot.players}); setSide(props.projectedSideFor(player.startNumber)); setTab("players"); }
  function chooseTab(id: Tab) {
    setTab(id);
    if (id === "players") { setInspected(null); setNewOnly(false); setQuery(""); }
  }
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault(); chooseTab(tabs[next][0]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  function actions(item: TournamentOpponentDatabase, colour = props.projectedSideFor(item.startNumber), compact = false, showStatus = true) {
    const ready = opponentReady(item);
    const hasProfile = /^[1-9]\d*$/.test(players.get(item.startNumber)?.fideId ?? "");
    if (!ready && !hasProfile) return <span className={styles.unavailableAction}>Import unavailable<HelpTip label={`Import unavailable for ${item.name}`}>No FIDE ID/profile is listed for this player. An exact tournament import is unavailable.</HelpTip></span>;
    const empty = item.status === "no-games" || (item.status === "ready" && item.gameCount === 0);
    const importing = item.status === "searching" || prepBusy === item.startNumber;
    const actionLabel = importing ? "Importing…" : item.status === "queued" ? "Queued" : ready ? "Open Prep" : empty ? "Search again" : item.status === "error" ? "Retry & prep" : "Import & prep";
    return <div className={styles.actions} data-compact={compact || undefined} aria-label={`Actions for ${item.name}`} role="group">
      {!compact && <button type="button" disabled={prepDisabled || importing} onClick={() => ready ? props.onOpenDatabase(item.collectionId!) : void props.onOpponent(item, colour, "import")}>{ready ? "View games" : item.status === "error" ? "Retry import" : "Import games"}</button>}
      <button type="button" className={ready ? styles.openPrep : undefined} data-database-ready={ready || undefined} disabled={prepDisabled || importing || item.status === "queued"} onClick={() => void props.onOpponent(item, colour, "prep")}>{actionLabel}</button>
      {compact && showStatus && (ready || empty || item.status === "error") && <small>{item.status === "error" && item.error ? importErrorHelp(item.error) : opponentGameLabel(item)}</small>}
    </div>;
  }
  const roundControl = <div className={styles.roundControl}>
    <button type="button" aria-label="Previous round" disabled={activeRound <= 1} onClick={() => setRound(activeRound - 1)}>‹</button>
    <label><span className={styles.srOnly}>Round</span><select value={activeRound} onChange={event => setRound(Number(event.target.value))}>{Array.from({ length: maxRound }, (_, index) => index + 1).map(value => <option key={value} value={value}>Round {value}</option>)}</select></label>
    <button type="button" aria-label="Next round" disabled={activeRound >= maxRound} onClick={() => setRound(activeRound + 1)}>›</button>
    <span>{activeRound === snapshot.liveRound ? "Live" : activeRound <= snapshot.completedRound ? "Complete" : "Pairings"}</span>
  </div>;
  const search = <label className={styles.search}><span className={styles.srOnly}>Find player</span><input value={query} placeholder="Find a player or FIDE ID" onChange={event => setQuery(event.target.value)} /></label>;
  const table = <div className={styles.tableScroll}>{standings.some(player => !player.scoreKnown) && <p className={styles.warning}>Some scores are missing. Points and order are unavailable for affected standings.</p>}<table className={styles.standings}>
    <thead><tr><th>{published ? "Rank" : "Order"}<HelpTip label="Rank">{published ? help.rank : help.order}</HelpTip></th><th>Player</th><th>Rating<HelpTip label="Rating">{help.rating}</HelpTip></th><th>Points<HelpTip label="Points">{help.points}</HelpTip></th><th>Recent form<HelpTip label="Recent form">{help.form}</HelpTip></th><th>Opponent games<HelpTip label="Opponent games">{help.games}</HelpTip></th><th><span className={styles.srOnly}>Preparation actions</span></th></tr></thead>
    <tbody>{visibleStandings.map(player => {
      const item = record.opponents[String(player.startNumber)];
      const isYou = player.startNumber === record.userStartNumber;
      const history = tournamentPlayerStats(snapshot, player.startNumber, activeRound).games.slice(0, 5).reverse();
      return <tr key={player.startNumber} data-user={isYou || undefined}><td>{player.rank ?? "—"}</td><td><button type="button" className={styles.playerLink} onClick={() => inspect(player)}>{player.name}{isYou && <small>You</small>}</button></td><td>{player.rating ?? "—"}</td><td>{player.scoreKnown ? player.points : "—"}</td><td><span className={styles.form}>{history.length ? history.map(game => <span key={game.round} title={`Round ${game.round}: ${game.result}`} data-result={game.result}>{game.result[0]}</span>) : "—"}</span></td><td>{item ? opponentGameLabel(item) : "Your entry"}</td><td>{item && actions(item, undefined, true, false)}</td></tr>;
    })}</tbody>
  </table>{!visibleStandings.length && <p className={styles.empty}>No matching players.</p>}</div>;
  const entrantList = <div className={styles.entrants}>
    <div className={styles.entrantHead}><span>Player</span><span>Rating<HelpTip label="Entry rating">{help.rating}</HelpTip></span><span>Saved games</span><span>Preparation</span></div>
    {visible.map(player => {
      const item=record.opponents[String(player.startNumber)];
      return <div key={player.startNumber} className={styles.entrantRow}>
        <button type="button" className={styles.playerLink} onClick={()=>inspect(player)}><strong>{player.name}</strong><small>{player.fideId?`FIDE ${player.fideId}`:"No FIDE ID listed"}</small><small>{player.startNumber===record.userStartNumber?"You":!seen.has(tournamentPlayerKey(player))?"New entry":player.federation}</small></button>
        <span><small className={styles.mobileLabel}>Rating</small>{player.rating??"Not listed"}</span>
        <span>{item?opponentGameLabel(item):"Your entry"}</span>
        {item?actions(item, undefined, true, false):<span/>}
      </div>;
    })}
    {!visible.length&&<p className={styles.empty}>{snapshot.players.length?"No matching players.":"Players not published yet."}</p>}
  </div>;
  return <div className={styles.tracker}>
    {props.onBack&&<button type="button" className={styles.back} disabled={settingBusy||removeBusy} onClick={props.onBack}>← Discover tournaments</button>}
    <header className={styles.header}>
      <div className={styles.eventOverview}>
        <h2>{record.title}</h2>
        <p>{[snapshot.section, eventDates, snapshot.metadata?.location, snapshot.timeControl, snapshot.totalRounds ? `${snapshot.totalRounds} rounds` : null].filter(Boolean).join(" · ")}</p>
        <TournamentStartCountdown info={snapshot}/>
      </div>
      <div className={styles.eventControls}>
        <TournamentWebsiteLink url={snapshot.metadata?.organizerUrl??record.url}>{snapshot.metadata?.organizerUrl?"Organizer":"Chess-Results"} ↗</TournamentWebsiteLink>
        <div className={styles.entryChoice}>
          {props.onChooseEntry && snapshot.format !== "team" && <label>Who are you?<select aria-label="Your entry" value={record.userStartNumber??""} disabled={busy||settingBusy||!snapshot.players.length} onChange={e=>void props.onChooseEntry?.(snapshot.players.find(p=>p.startNumber===Number(e.target.value))??null)}><option value="">Select your name</option>{snapshot.players.map(player=><option key={player.startNumber} value={player.startNumber}>{player.name}{player.fideId?` · FIDE ${player.fideId}`:""}</option>)}</select></label>}
          <button type="button" aria-label="Refresh tournament" disabled={busy||settingBusy} onClick={()=>void props.onCheck()}>Refresh</button>
          <HelpTip label="Entry and pairing checks">Checks published players and pairings. Following does not register you for the event.</HelpTip>
          {record.userStartNumber===null&&record.userName&&<span role="status">Your previous entry, {record.userName}, could not be matched. Select your name again.</span>}
        </div>
      </div>
    </header>
    <div className={styles.tabs} role="tablist" aria-label="Tournament views" aria-orientation="horizontal">{tabs.map(([id, label], index) => <button key={id} id={`tournament-${id}-tab`} type="button" role="tab" aria-label={label} aria-description={id === "players" ? `${snapshot.players.length} registered players` : undefined} aria-selected={tab === id} aria-controls="tournament-tab-panel" tabIndex={tab === id ? 0 : -1} onClick={() => chooseTab(id)} onKeyDown={event => tabKeys(event, index)}>{label}{id === "players" && <span aria-hidden="true"> ({snapshot.players.length})</span>}</button>)}</div>
    {snapshot.warnings.length > 0 && <p className={styles.warning} role="status">Incomplete source data: {snapshot.warnings[0]}</p>}
    {yourRound > 0&&record.userStartNumber!==null&&<div className={styles.summary} aria-label="Tournament status summary">
      <div className={styles.metric}><span>Your {yourRankPublished ? "place" : "order"}<HelpTip label="Your place">{yourRankPublished ? help.rank : help.order}</HelpTip></span><strong>{you?.rank ?? "—"}</strong></div>
      <div className={styles.metric}><span>Your points<HelpTip label="Your points">{`${help.points} Shown as points / completed rounds.`}</HelpTip></span><strong>{you?.scoreKnown ? you.points : "—"} / {yourRound}</strong></div>
      <span className={styles.phase}>{tournamentPhaseLabel(snapshot)}</span>
    </div>}
    {snapshot.format==="team"&&<p className={styles.warning}>Team-board preparation is unavailable.</p>}
    {settingBusy && <div className={styles.progress} role="status">Saving changes…</div>}
    {(running || prepBusy !== null) && <div className={styles.progress} role="status"><span>{currentSyncEvent?.message ?? "Checking tournament…"}</span><button type="button" disabled={currentSyncEvent?.phase === "stopping"} onClick={() => void props.onStop()}>{currentSyncEvent?.phase === "stopping" ? "Stopping…" : "Stop current update"}</button></div>}
    {checkError && <div className={styles.error} role="alert"><p>Tournament check failed: {checkError}</p><button type="button" disabled={busy || settingBusy} onClick={() => void props.onCheck()}>Retry check</button></div>}
    {error && error !== checkError && <p className={styles.error} role="alert">{error}</p>}
    <section id="tournament-tab-panel" role="tabpanel" aria-labelledby={`tournament-${tab}-tab`} className={styles.panel}>
      {tab === "next" && <>
        <div className={styles.sectionHeader}>
          <h3>{forecastHeading(forecast, beforePlay)}</h3>
          {beforePlay && forecast?.kind !== "confirmed" && forecast?.kind !== "scheduled" && <span className={styles.beforePlay}>Pairings not published<HelpTip label="Before round one">Predictions use the current entries. Late entries and organiser settings can change the opponent; only published pairings confirm it.</HelpTip></span>}
          {calculating && <span role="status">Updating forecast…</span>}
          <span className={styles.importYear}>Games since {record.fromYear}<HelpTip label="Games since">Find games played in this year or later. You can change the year before importing.</HelpTip></span>
        </div>
        {resultContext && <div className={styles.forecastContext}>
          <span>{resultContext.label}<HelpTip label="Results used for predictions">Only results reported by the organiser are known. Predictions can change as unfinished games end or the organiser updates the entries and pairing rules.</HelpTip></span>
          {resultContext.total > 0 && <button type="button" onClick={() => { setRound(resultContext.round); setTab("results"); }}>View round {resultContext.round} results →</button>}
        </div>}
        {!!forecast?.candidates.length ? <div className={styles.candidates}>
          <div className={styles.candidateHead}><span>Opponent</span><span>Rating<HelpTip label="Opponent rating">{help.rating}</HelpTip></span><span>{fixed ? "Pairing" : "Pairing chance"}{(!fixed || inferred) && <HelpTip label={inferred ? "Expected pairing" : "Pairing chance"}>{inferred ? forecast?.caveat ?? "Predicted from the players’ starting numbers. The organiser has not confirmed this pairing." : pairingEstimateHelp(snapshot, forecast) ?? help.chance}</HelpTip>}</span><span>{colourLabel}<HelpTip label="Your colour">{publishedColour ? "Your colour in the published pairing." : help.colour}</HelpTip></span><span>Preparation<HelpTip label="Games and preparation">{help.actions}</HelpTip></span></div>
          {forecast.candidates.map(candidate => {
            const item = record.opponents[String(candidate.player.startNumber)];
            const colour = candidate.color ?? props.projectedSideFor(candidate.player.startNumber);
            return <div className={styles.candidateRow} key={candidate.player.startNumber}>
              <button type="button" className={styles.playerLink} onClick={() => inspect(candidate.player)}><strong>{candidate.player.name}</strong><small>{candidate.player.fideId ? `FIDE ${candidate.player.fideId}` : "No FIDE ID/profile listed"}{candidate.board ? ` · Board ${candidate.board}` : ""}</small></button>
              <div className={styles.rating}><span className={styles.mobileLabel}>Rating</span>{candidate.player.rating ?? "Not listed"}</div>
              <div className={styles.chance}><span className={styles.mobileLabel}>{fixed ? "Pairing" : "Pairing chance"}{(!fixed || inferred) && <HelpTip label={`${inferred ? "Expected pairing" : "Pairing chance"} for ${candidate.player.name}`}>{inferred ? forecast.caveat ?? "Predicted from the players’ starting numbers. The organiser has not confirmed this pairing." : pairingEstimateHelp(snapshot, forecast) ?? help.chance}</HelpTip>}</span><strong>{fixed ? forecast.kind === "confirmed" ? "Published" : inferred ? "Expected" : "Scheduled" : formatForecastPercent(candidate.probability)}</strong></div>
              <div className={styles.colour}><span className={styles.mobileLabel}>{colourLabel}</span>{candidate.color === null ? "Not known" : candidate.color === "white" ? "White" : "Black"}</div>
              {item ? actions(item, colour, true) : <span className={styles.unavailableAction}>Refresh roster to prepare</span>}
            </div>;
          })}
          {forecast.kind === "estimated" && forecast.otherProbability !== null && forecast.otherProbability > 0 && <div className={styles.other}>Other opponents or no game <HelpTip label="Other outcomes">{"Chance of a different opponent or no game this round. Rounding may keep the percentages from adding to 100%."}</HelpTip><strong>{formatForecastPercent(forecast.otherProbability)}</strong></div>}
        </div> : forecast?.kind === "complete" ? <><div className={styles.sectionHeader}><h3>Standings</h3>{roundControl}</div>{search}{table}</> : <p className={styles.empty}>{!snapshot.players.length?"Players not published yet.":record.userStartNumber===null?"Choose your entry to see your predicted opponents.":forecast?.summary ?? "No pairing prediction is available yet."}</p>}
      </>}
      {(tab === "standings" || tab === "results") && (beforePlay ? <p className={styles.empty}>{tab === "standings" ? "Standings" : "Results"} not published yet.</p> : <><div className={styles.sectionHeader}><h3>{tab === "standings" ? "Standings" : "Results"}</h3>{roundControl}</div>{tab === "standings" ? <>{search}{table}</> : <div className={styles.results}>{roundPairings(snapshot, activeRound).map((pairing, index) => <div className={styles.resultRow} key={index}><span>{pairing.whiteStartNumber === null || pairing.blackStartNumber === null ? "No board" : pairing.board ? `Board ${pairing.board}` : "Board not listed"}</span>{([pairing.whiteStartNumber, pairing.blackStartNumber] as const).map((number, sideIndex) => {const player = number === null ? null : players.get(number);return <div key={sideIndex}><small>{sideIndex ? "Black" : "White"}</small>{player ? <button type="button" className={styles.playerLink} onClick={() => inspect(player)}>{player.name}</button> : number === null ? "No opponent" : `Player ${number} not listed`}</div>;})}<strong>{tournamentResultLabel(pairing, snapshot)}</strong></div>)}{!roundPairings(snapshot, activeRound).length && <p className={styles.empty}>No pairings published for round {activeRound}.</p>}</div>}</>)}
      {tab === "players" && <><div className={styles.sectionHeader}><h3>{beforePlay?"Registered players":"Players"}</h3>{!beforePlay&&selected&&roundControl}{inspected && <button type="button" onClick={() => setInspected(null)}>All players</button>}{newPlayers.length>0&&<><label className={styles.newFilter}><input type="checkbox" checked={newOnly} onChange={e=>setNewOnly(e.target.checked)}/>{newPlayers.length} new</label>{props.onReviewed&&<button type="button" disabled={settingBusy} onClick={()=>{setNewOnly(false);void props.onReviewed?.();}}>Mark reviewed</button>}</>}</div>{inspected && !selected && <p className={styles.warning} role="status">The entry for {inspected.player.name} has changed or is no longer uniquely listed. Choose a player below to continue.</p>}{!selected || !stats ? <>{search}{entrantList}</> : <>
        <div className={styles.sectionHeader}><div><h3>{selected.name}{selected.startNumber === record.userStartNumber ? " · You" : ""}</h3><p>{[selected.title, selected.rating === null ? "Rating not listed" : `${selected.rating} rating`, selected.federation].filter(Boolean).join(" · ")}</p></div>{selected.fideId ? <TournamentWebsiteLink url={`https://ratings.fide.com/profile/${selected.fideId}`}>FIDE {selected.fideId} ↗</TournamentWebsiteLink> : <span>No FIDE ID/profile listed for this player.</span>}</div>
        {snapshot.completedRound > 0&&<><dl className={styles.playerMetrics}><div><dt>{published ? "Rank" : "Order"}<HelpTip label="Player rank">{published ? help.rank : help.order}</HelpTip></dt><dd>{selectedStanding?.rank ?? "—"}</dd></div><div><dt>Points<HelpTip label="Player points">{help.points}</HelpTip></dt><dd>{selectedStanding?.scoreKnown ? selectedStanding.points : "—"}</dd></div><div><dt>Performance<HelpTip label="Performance rating">{"An estimated rating based on results against rated opponents. Winning or losing every game gives only a rough estimate."}</HelpTip></dt><dd>{stats.performanceRating ?? "—"}</dd></div><div><dt>Average opponent<HelpTip label="Average opponent rating">{"Average rating of opponents already played. Opponents without a rating are left out."}</HelpTip></dt><dd>{stats.averageOpponent ?? "—"}</dd></div></dl><p className={styles.playerSummary}>{stats.wins} wins · {stats.draws} draws · {stats.losses} losses <span>{stats.whiteGames} games as White · {stats.blackGames} as Black</span></p></>}
        {opponent ? <div className={styles.preparation}><div><h3>Opponent games</h3><p>{opponentGameLabel(opponent)} · Since {opponent.importFromYear ?? record.fromYear}</p></div><div className={styles.sidePicker} role="group" aria-label="Your preparation colour"><span>Prepare as</span>{(["white", "black"] as const).map(value => <button key={value} type="button" aria-pressed={side === value} onClick={() => setSide(value)}>{value === "white" ? "White" : "Black"}</button>)}</div>{actions(opponent, side)}{opponent.error && <p className={styles.error}>{opponent.error}</p>}</div> : <p>This is your tournament entry.</p>}
        {snapshot.completedRound > 0 && <><h3>Game history <small>Through round {activeRound}</small></h3><div className={styles.gameHistory}>{stats.games.map(game => <div key={game.round}><span>Round {game.round}</span><strong>{game.result}</strong><span>{game.opponent.name}</span><small>{game.side === "white" ? "White" : "Black"} · {game.opponent.rating === null ? "Rating not listed" : `${game.opponent.rating} rating`}</small></div>)}{!stats.games.length && <p className={styles.empty}>No completed games by this round.</p>}</div></>}
      </>}</>}
      {tab === "tracking" && <div className={styles.settings}>
        <section><h3>Updates</h3><div className={styles.settingRow}><label><input type="checkbox" checked={record.autoUpdate} disabled={settingBusy || removeBusy} onChange={() => void props.onToggleUpdate()} />Automatically check entries and pairings</label><HelpTip label="Automatic pairing checks">{"Checks every 15 minutes while En Croissant is open. This does not import games."}</HelpTip></div><p>{record.lastRosterSyncAt?`Last checked ${new Date(record.lastRosterSyncAt).toLocaleString()}`:"Not checked yet"}</p><button type="button" disabled={busy} onClick={() => void props.onCheck()}>Check tournament</button></section>
        <section><h3>Opponent databases<HelpTip label="Database counts">{"Ready means games are saved. Checked, no games means the search finished but found none."}</HelpTip></h3><p>{readyCount} ready · {emptyCount} checked, no games</p><p>Default import year: {record.fromYear}</p></section>
        <section><h3>Following</h3>{props.onUnfollow&&<button type="button" disabled={removeBusy} onClick={()=>void props.onUnfollow?.()}>Stop following…</button>}<details className={styles.deleteDetails}><summary>Delete tracker and games</summary><p>{tournamentPrepDatabaseIds(record).length} opponent databases will also be deleted.</p><button type="button" className={styles.danger} disabled={removeBusy} onClick={() => void props.onRemove()}>{removeBusy ? "Removing…" : "Remove tracker…"}</button></details></section>
      </div>}
    </section>
  </div>;
}
