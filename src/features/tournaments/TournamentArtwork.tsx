import { useEffect, useRef, useState } from "react";
import type { TournamentEventMetadata } from "@/features/tournaments/platform";
import { loadTournamentMetadata } from "./tournamentDiscoveryModel";
import styles from "./TournamentDiscovery.module.css";

export function TournamentArtwork({url,metadata,enabled}:{url:string;date?:string|null;metadata?:TournamentEventMetadata;enabled?:boolean}){
  let show=enabled??true;
  if(enabled===undefined){try{show=localStorage.getItem("encroissant.tournaments.images")!=="off";}catch{/* Use the default. */}}
  const [details,setDetails]=useState(metadata);
  const [failed,setFailed]=useState(false);
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    setDetails(metadata);setFailed(false);
    if(!show||metadata?.imageUrl)return;
    const controller=new AbortController();
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting)){
        observer.disconnect();void loadTournamentMetadata(url,controller.signal).then(result=>{if(result&&!controller.signal.aborted)setDetails(result);}).catch(()=>{});
      }
    },{rootMargin:"120px"});
    if(host.current)observer.observe(host.current);
    return()=>{controller.abort();observer.disconnect();};
  },[url,metadata,show]);
  // Keep the lazy metadata observation target when artwork is absent, without
  // reserving a decorative hero or inventing an event image.
  const candidate=details?.imageUrl?.replace(/^http:/,"https:");
  const image=show&&!failed&&candidate?.startsWith("https:")?candidate:null;
  if(!show)return null;
  return <div ref={host} className={styles.artwork} data-empty={!image||undefined} aria-hidden="true">{image&&<img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>}</div>;
}
