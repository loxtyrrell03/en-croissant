import { TournamentStartCountdown } from "./TournamentStartCountdown";
import { useEffect, useRef, useState } from "react";
import { HelpTip } from "@/features/tournaments/ui";
import { desktopApi, isDesktop, type TournamentDiscoveryResponse, type TournamentSearchResult } from "@/features/tournaments/platform";
import { isChessResultsTournamentUrl } from "./tournamentFinder";
import { searchTournamentEvents } from "./tournamentSearch";
import { supplementTournamentCandidates } from "./tournamentSearchCandidates";
import { tournamentPlayerKey, type TournamentPrepMap } from "./tournamentPrepStore";
import { countries, countryName, defaultDiscoveryFilters, discoveryCache, discoveryRequest, lastDiscoveryFilters, readableDate, regions, rememberDiscoveryFilters, type DiscoveryFilters } from "./tournamentDiscoveryModel";
import { TournamentArtwork } from "./TournamentArtwork";
import { tournamentCountdown } from "./tournamentStart";
import styles from "./TournamentDiscovery.module.css";

interface Props {records:TournamentPrepMap;onInspect:(url:string)=>void;onOpen:(id:string)=>void;busy:boolean;onCancel:()=>void;error:string|null;}
export function TournamentDiscovery({records,onInspect,onOpen,busy,onCancel,error}:Props){
  const [filters,setFilters]=useState<DiscoveryFilters>(()=>lastDiscoveryFilters??defaultDiscoveryFilters());
  const [view,setView]=useState<"discover"|"following">(()=>Object.keys(records).length?"following":"discover");
  const choseView=useRef(false);
  useEffect(()=>{if(!choseView.current&&Object.keys(records).length)setView("following");},[records]);
  const [response,setResponse]=useState<TournamentDiscoveryResponse|null>(null);
  const [searching,setSearching]=useState(false);
  const [searchError,setSearchError]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const [visibleCount,setVisibleCount]=useState(20);
  const [images,setImages]=useState(()=>{try{return localStorage.getItem("encroissant.tournaments.images")!=="off";}catch{return true;}});
  const [sort,setSort]=useState("auto");
  const [filtersOpen,setFiltersOpen]=useState(false);
  const sequence=useRef(0);
  const currentKey=useRef("");
  const [resultKey,setResultKey]=useState("");
  // Search the same candidate listings as browsing. The source name filter
  // only matches title prefixes and cannot support fuzzy/location searches.
  const request=discoveryRequest({...filters,query:""});
  const sourceKey=JSON.stringify(request);
  const key=JSON.stringify({...request,query:filters.query.trim()});
  const isLink=isChessResultsTournamentUrl(filters.query);
  useEffect(()=>{rememberDiscoveryFilters(filters);setVisibleCount(20);},[filters]);
  useEffect(()=>{
    const owner=++sequence.current;
    currentKey.current=key;
    setSearchError(null);setSearching(false);setVisibleCount(20);
    if(isLink||view!=="discover")return;
    const cached=discoveryCache.get(key);
    const browse=discoveryCache.get(sourceKey);
    const available=cached??browse;
    setResponse(available??null);setResultKey(available?key:"");
    const fresh=(value:TournamentDiscoveryResponse|undefined)=>!!value&&Date.now()-Date.parse(value.fetchedAt)<5*60_000;
    if(fresh(cached)||(fresh(browse)&&(!browse!.sourceLimitReached||!filters.query.trim())))return;
    setSearching(true);
    const timeout=window.setTimeout(()=>{
      if(owner!==sequence.current)return;
      if(!isDesktop()){setSearchError("Tournament discovery is available in the desktop app.");setSearching(false);return;}
      void (async()=>{
        const result=fresh(browse)?browse!:await desktopApi.discoverTournaments(JSON.parse(sourceKey));
        if(owner!==sequence.current)return result;
        discoveryCache.set(sourceKey,result);setResponse(result);setResultKey(key);
        return supplementTournamentCandidates(JSON.parse(sourceKey),filters.query,result,desktopApi.discoverTournaments,()=>owner===sequence.current);
      })().then(result=>{
        if(owner!==sequence.current)return;
        discoveryCache.set(key,result);if(discoveryCache.size>20)discoveryCache.delete(discoveryCache.keys().next().value!);
        setResponse(result);setResultKey(key);
      }).catch(caught=>{if(owner===sequence.current)setSearchError(caught instanceof Error?caught.message:String(caught));})
        .finally(()=>{if(owner===sequence.current)setSearching(false);});
    },filters.query?360:100);
    return()=>{window.clearTimeout(timeout);if(sequence.current===owner)sequence.current++;};
  },[key,sourceKey,revision,view,isLink,filters.query]);
  function change<K extends keyof DiscoveryFilters>(field:K,value:DiscoveryFilters[K]){
    setFilters(previous=>({...previous,[field]:value,...(field==="region"?{country:""}:{})}));
  }
  function retry(){discoveryCache.delete(currentKey.current);discoveryCache.delete(sourceKey);setRevision(v=>v+1);}
  const events=resultKey===key?searchTournamentEvents(filters.query,response?.events??[]):[];
  if(sort!=="auto"||!filters.query.trim())events.sort((a,b)=>sort==="name"?a.title.localeCompare(b.title):(a.startDate??"9999").localeCompare(b.startDate??"9999")*(sort==="latest"?-1:1));
  const tracked=Object.values(records).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const following=<section className={styles.following} aria-label="Following tournaments"><h2>{tracked.length} followed {tracked.length===1?"tournament":"tournaments"}</h2>{tracked.length?tracked.map(record=>{
    const seen=new Set(record.seenPlayerKeys??record.snapshot.players.map(tournamentPlayerKey));
    const fresh=record.snapshot.players.filter(player=>!seen.has(tournamentPlayerKey(player))).length;
    const dates=record.snapshot.dateRange?.split(" to ");
    const countdown=tournamentCountdown(record.snapshot,Date.now());
    const dateInCountdown=!!countdown?.dateTime&&countdown.dateTime.slice(0,10)===dates?.[0]?.replaceAll("/","-");
    const date=dateInCountdown?(dates?.[1]?`Ends ${readableDate(dates[1])}`:null):record.snapshot.dateRange;
    return <article key={record.id}><div><h3><button type="button" onClick={()=>onOpen(record.id)}>{record.title}</button></h3><p>{[date,record.snapshot.section,record.snapshot.metadata?.location].filter(Boolean).join(" · ")}</p>
      <TournamentStartCountdown info={record.snapshot} compact/>
      {fresh>0&&<span className={styles.newBadge}>{fresh} new players</span>}
      <p>{record.snapshot.players.length?`${record.snapshot.players.length} published players`:"Players not published yet"}</p></div>
      <button type="button" className={styles.secondary} onClick={()=>onOpen(record.id)}>{fresh?"Review players":"Open tracker"}</button></article>;}):<p className={styles.empty}>No followed tournaments.</p>}</section>;
  function eventCard(event:TournamentSearchResult){
    return <article key={event.tournamentId} className={styles.eventCard}>
      {images&&<TournamentArtwork url={event.sourceUrl} date={event.startDate} enabled={images}/>}
      <div className={styles.cardBody}>
        <h3><button type="button" onClick={()=>onInspect(event.sourceUrl)} disabled={busy}>{event.title}</button></h3>
        <p className={styles.location}>{[event.location,countryName(event.federation),event.section,event.timeControl].filter(Boolean).join(" · ")||"Location and time control not published"}</p>
        {filters.period==="upcoming"?<><TournamentStartCountdown info={{dateRange:event.startDate}} compact/>{event.endDate&&event.endDate!==event.startDate&&<p className={styles.cardDetails}>Ends {readableDate(event.endDate)}</p>}</>:<time>{readableDate(event.startDate)}{event.endDate&&event.endDate!==event.startDate?` – ${readableDate(event.endDate)}`:""}</time>}
        <footer><span>{event.playerCount==null?"Players not published yet":`${event.playerCount.toLocaleString()} published players`}</span><button type="button" disabled={busy} className={styles.secondary} onClick={()=>records[event.tournamentId]?onOpen(event.tournamentId):onInspect(event.sourceUrl)}>{records[event.tournamentId]?"Open tracker":"View event"}</button></footer>
      </div></article>;
  }
  return <div className={styles.discovery}>
    <nav className={styles.viewTabs} aria-label="Tournament directory"><button type="button" aria-pressed={view==="discover"} onClick={()=>{choseView.current=true;setView("discover");}}>Discover</button><button type="button" aria-pressed={view==="following"} onClick={()=>{choseView.current=true;setView("following");}}>Following · {tracked.length}</button></nav>
    {view==="discover"&&<>
      <div className={styles.filters} data-open={filtersOpen}>
        <label className={styles.searchField}><span>Search <HelpTip label="Tournament search">Matches names, places and organizers, including misspellings and words in any order.</HelpTip></span><input aria-label="Search tournaments" value={filters.query} maxLength={500} placeholder="Name, place or Chess-Results link" onChange={e=>change("query",e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&isLink&&!busy)onInspect(filters.query);}}/></label>
        <button className={styles.narrowFilters} type="button" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(!filtersOpen)}>{filtersOpen?"Close filters":"Filters"}{filters.region||filters.country?` · ${filters.country?countryName(filters.country):filters.region}`:""}</button>
        <label>Dates<select aria-label="Dates" value={filters.dates} onChange={e=>change("dates",e.target.value)}><option value="1">{filters.period==="past"?"Past month":"Next month"}</option><option value="3">{filters.period==="past"?"Past 3 months":"Next 3 months"}</option><option value="12">{filters.period==="past"?"Past year":"Next year"}</option><option value="custom">Custom dates</option></select></label>
        <label>Region<select aria-label="Region" value={filters.region} onChange={e=>change("region",e.target.value)}><option value="">All regions</option>{regions.map(region=><option key={region}>{region}</option>)}</select></label>
        <label>Country / federation<select aria-label="Country / federation" value={filters.country} onChange={e=>change("country",e.target.value)}><option value="">All countries</option>{countries.filter(c=>!filters.region||c.regions.includes(filters.region)).map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      </div>
      {filters.dates==="custom"&&<div className={styles.customDates}><label>From<input type="date" value={filters.from} onChange={e=>change("from",e.target.value)}/></label><label>To<input type="date" value={filters.to} onChange={e=>change("to",e.target.value)}/></label></div>}
      <div className={styles.filterBar}><div className={styles.periods} aria-label="Event period">{([['upcoming','Upcoming'],['ongoing','Ongoing'],['past','Past']] as const).map(([id,title])=><button type="button" key={id} aria-pressed={filters.period===id} onClick={()=>change("period",id)}>{title}</button>)}</div>
        <details className={styles.moreFilters}><summary>More filters{filters.timeControl||filters.location||filters.includeUndated?` · ${[filters.timeControl?({"1":"Classical","2":"Rapid","3":"Blitz"} as Record<string,string>)[filters.timeControl]:null,filters.location,filters.includeUndated?"Undated":null].filter(Boolean).join(" · ")}`:""}</summary><div><label>Time control<select aria-label="Time control" value={filters.timeControl} onChange={e=>change("timeControl",e.target.value)}><option value="">All</option><option value="1">Classical</option><option value="2">Rapid</option><option value="3">Blitz</option></select></label><label>City / area<input value={filters.location} maxLength={30} onChange={e=>change("location",e.target.value)} placeholder="Any location"/></label><label className={styles.check}><input type="checkbox" checked={filters.includeUndated} onChange={e=>change("includeUndated",e.target.checked)}/>Include dates to be confirmed</label><label className={styles.check}><input type="checkbox" checked={images} onChange={e=>{setImages(e.target.checked);try{localStorage.setItem("encroissant.tournaments.images",e.target.checked?"on":"off");}catch{/* Optional display preference. */}}}/>Organizer images<HelpTip label="Organizer images">Shows artwork published with the event when available. Missing artwork leaves the event row unchanged.</HelpTip></label><button type="button" onClick={()=>setFilters(defaultDiscoveryFilters())}>Clear filters</button></div></details>
      </div>
      {isLink&&<button type="button" className={styles.primary} disabled={busy} onClick={()=>onInspect(filters.query)}>Open tournament link</button>}
    </>}
    {(busy||searching)&&<div className={styles.status} role="status"><span>{busy?"Loading tournament…":"Finding tournaments…"}</span><button type="button" onClick={()=>{if(busy)onCancel();else {sequence.current++;setSearching(false);}}}>Cancel</button></div>}
    {(searchError||error)&&<div className={styles.error} role="alert"><span>{error??searchError}{response&&resultKey===key&&searchError?` Showing results checked ${new Date(response.fetchedAt).toLocaleString()}.`:""}</span>{searchError&&<button type="button" onClick={retry}>Retry</button>}</div>}
    {view==="following"?following:<section aria-label="Tournament results">
      <div className={styles.resultsHeading}><h2>{filters.period==="upcoming"?"Upcoming tournaments":filters.period==="ongoing"?"Ongoing tournaments":"Past tournaments"}</h2><label><span className={styles.srOnly}>Sort tournaments</span><select value={sort==="auto"&&!filters.query.trim()?"soonest":sort} onChange={e=>setSort(e.target.value)}><option value="auto" disabled={!filters.query.trim()}>Best match</option><option value="soonest">Soonest first</option><option value="latest">Latest first</option><option value="name">Name</option></select></label></div>
      {response?.sourceLimitReached&&resultKey===key&&<p className={styles.warning} role="status">The source limit was reached; some listings may be missing. Choose a country to search more completely.</p>}
      <div className={styles.cards}>{events.slice(0,visibleCount).map(eventCard)}</div>
      {!searching&&!isLink&&!searchError&&response&&resultKey===key&&!events.length&&<div className={styles.empty}><p>No matching events.</p><button type="button" onClick={()=>setFilters(defaultDiscoveryFilters())}>Clear filters</button></div>}
      {events.length>0&&<div className={styles.resultsFooter}><span>Showing {Math.min(events.length,visibleCount)} of {events.length} events</span>{visibleCount<events.length&&<button type="button" onClick={()=>setVisibleCount(n=>n+20)}>Show more</button>}</div>}
    </section>}
    <footer className={styles.source}>Chess-Results<HelpTip label="Tournament source">Dates and entries come from the organizer’s listing. Country filters use the source federation. A source limit is shown when listings may be incomplete.</HelpTip></footer>
  </div>;
}
