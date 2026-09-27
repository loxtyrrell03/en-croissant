import { TournamentStartCountdown } from "./TournamentStartCountdown";
import { useMemo, useState } from "react";
import { HelpTip } from "@/features/tournaments/ui";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { rankTournamentPlayers } from "./tournamentFinder";
import { TournamentWebsiteLink } from "./TournamentWebsiteLink";
import { TournamentArtwork } from "./TournamentArtwork";
import { tournamentCountdown } from "./tournamentStart";
import { readableDate } from "./tournamentDiscoveryModel";
import styles from "./TournamentDiscovery.module.css";
interface Props {snapshot:TournamentSnapshot;selectedPlayer:number|null;onSelectPlayer:(n:number|null)=>void;fromYear:number;onYear:(n:number)=>void;onSection:(url:string)=>void;onBack:()=>void;onFollow:()=>void;busy:boolean;saving:boolean;error:string|null;}
export function TournamentEventPreview({snapshot,selectedPlayer,onSelectPlayer,fromYear,onYear,onSection,onBack,onFollow,busy,saving,error}:Props){
  const [query,setQuery]=useState("");
  const players=useMemo(()=>rankTournamentPlayers(query,snapshot.players),[query,snapshot.players]);
  const sections=snapshot.sections?.length?snapshot.sections:[{tournamentId:snapshot.tournamentId,sourceUrl:snapshot.sourceUrl,name:snapshot.section??"Main section"}];
  const user=snapshot.players.find(p=>p.startNumber===selectedPlayer);
  const countdown=tournamentCountdown(snapshot,Date.now());
  const dates=snapshot.dateRange?.split(" to ");
  const dateInCountdown=!!countdown?.dateTime&&countdown.dateTime.slice(0,10)===dates?.[0]?.replaceAll("/","-");
  const eventDates=dateInCountdown?(dates?.[1]?`Ends ${readableDate(dates[1])}`:null):snapshot.dateRange;
  return <div className={styles.preview}>
    <button type="button" className={styles.back} disabled={saving} onClick={onBack}>← Discover tournaments</button>
    <header className={styles.previewHeader}>
      <TournamentArtwork url={snapshot.sourceUrl} metadata={snapshot.metadata}/>
      <div><h2>{snapshot.title}</h2>
        <p>{[eventDates,snapshot.metadata?.location,snapshot.timeControl,snapshot.totalRounds?`${snapshot.totalRounds} rounds`:null].filter(Boolean).join(" · ")||"Location and time control not published"}</p>
        <TournamentStartCountdown info={snapshot} compact/>
      </div>
    </header>
    <div className={styles.previewFacts}>{sections.length>1&&<label>Section<select aria-label="Section" value={snapshot.tournamentId} disabled={busy||saving||sections.length<2} onChange={e=>{const section=sections.find(s=>s.tournamentId===e.target.value);if(section)onSection(section.sourceUrl);}}>{sections.map(s=><option value={s.tournamentId} key={s.tournamentId}>{s.name}</option>)}</select></label>}
      <div>{snapshot.metadata?.organizerUrl?<TournamentWebsiteLink url={snapshot.metadata.organizerUrl}>Organizer website ↗</TournamentWebsiteLink>:<TournamentWebsiteLink url={snapshot.sourceUrl}>Chess-Results ↗</TournamentWebsiteLink>}</div></div>
    {snapshot.warnings.length>0&&<p className={styles.warning} role="status">{snapshot.warnings[0]}</p>}
    {snapshot.format==="team"&&<p>Team-board preparation is unavailable.</p>}
    <div className={styles.entryHeading}>
      {snapshot.format!=="team"&&<><label>Who are you?<select aria-label="Your entry" value={selectedPlayer??""} disabled={busy||saving||!snapshot.players.length} onChange={e=>onSelectPlayer(e.target.value?Number(e.target.value):null)}><option value="">Select your name</option>{snapshot.players.map(player=><option key={player.startNumber} value={player.startNumber}>{player.name}{player.fideId?` · FIDE ${player.fideId}`:""}</option>)}</select></label><HelpTip label="Your tournament entry">Choose yourself from the published entries to see your pairings. You can also follow an event before your entry appears.</HelpTip></>}
      <div className={styles.followAction}><button type="button" className={styles.primary} disabled={busy||saving} onClick={onFollow}>{saving?"Saving…":"Follow tournament"}</button><HelpTip label="Follow tournament">Checks entries and pairings every 15 minutes while En Croissant is open. Following does not register you for the event.</HelpTip></div>
    </div>
    {busy&&<p role="status">Loading section…</p>}{error&&<div className={styles.error} role="alert">{error}</div>}
    {snapshot.format!=="team"&&<section className={styles.roster} aria-label="Registered players">
      <h3>Registered players ({snapshot.players.length})</h3>
      {!!snapshot.players.length&&<><label>Find a player or FIDE ID<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <ul className={styles.entryList} aria-label="Tournament players">{players.map(player=><li key={player.startNumber} data-selected={selectedPlayer===player.startNumber||undefined}><span><strong>{player.name}</strong><small>{[player.rating===null?"Rating not listed":`${player.rating} rating`,player.fideId?`FIDE ${player.fideId}`:"No FIDE ID/profile listed",player.federation].filter(Boolean).join(" · ")}</small></span><button type="button" disabled={busy||saving} aria-pressed={selectedPlayer===player.startNumber} aria-label={`${user?.startNumber===player.startNumber?"Selected entry":"This is me"}: ${player.name}`} onClick={()=>onSelectPlayer(player.startNumber)}>{user?.startNumber===player.startNumber?"You":"This is me"}</button></li>)}</ul></>}
      {!players.length&&<p>{snapshot.players.length?"No matching players.":"Players not published yet. You can select your entry when they appear."}</p>}
    </section>}
    <details><summary>Preparation settings</summary><label style={{marginTop:12}}>Games since<input type="number" min="1900" max={new Date().getFullYear()} disabled={busy||saving} value={fromYear} onChange={e=>onYear(Number(e.target.value))}/></label></details>
  </div>;
}
