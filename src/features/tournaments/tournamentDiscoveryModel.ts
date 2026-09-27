import { desktopApi, type TournamentDiscoveryRequest, type TournamentDiscoveryResponse, type TournamentEventMetadata } from "@/features/tournaments/platform";
import countries from "./tournamentCountries.json";
export { countries };
export const regions = ["UK & Ireland", "Europe", "Asia", "Africa", "Americas", "Oceania"];
export interface DiscoveryFilters {query:string; region:string; country:string; dates:string; from:string; to:string; location:string; timeControl:string; period:TournamentDiscoveryRequest["period"]; includeUndated:boolean;}
export const dateOnly=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
export function defaultDiscoveryFilters():DiscoveryFilters{return {query:"",region:"",country:"",dates:"3",from:dateOnly(),to:dateOnly(),location:"",timeControl:"",period:"upcoming",includeUndated:false};}
export function discoveryRequest(filters:DiscoveryFilters, now=new Date()):TournamentDiscoveryRequest{
  const today=dateOnly(now), end=new Date(now), start=new Date(now);
  const months=Number(filters.dates)||3;
  const shift=(date:Date,amount:number)=>{const day=date.getDate();date.setDate(1);date.setMonth(date.getMonth()+amount);date.setDate(Math.min(day,new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));};
  if(filters.period==="past")shift(start,-months);else shift(end,months);
  return {query:filters.query.trim(),country:filters.country,federations:filters.region?countries.filter(c=>c.regions.includes(filters.region)).map(c=>c.code):[],
    location:filters.location.trim(),timeControl:filters.timeControl,today,period:filters.period,includeUndated:filters.includeUndated,
    from:filters.dates==="custom"?filters.from:dateOnly(start),to:filters.dates==="custom"?filters.to:dateOnly(end)};
}
export function readableDate(value:string|null|undefined):string{
  if(!value)return "Date to be confirmed";
  const match=value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if(!match)return value;
  return new Date(Number(match[1]),Number(match[2])-1,Number(match[3])).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
}
export function countryName(code:string|null|undefined):string{return countries.find(c=>c.code===code)?.name??code??"";}
export const discoveryCache=new Map<string,TournamentDiscoveryResponse>();
// User review/navigation retains the form without making saved settings part
// of every keystroke. No user location is inferred.
export let lastDiscoveryFilters:DiscoveryFilters|null=null;
export function rememberDiscoveryFilters(filters:DiscoveryFilters){lastDiscoveryFilters=filters;}
const metadataCache=new Map<string,{value:TournamentEventMetadata;expires:number}>();
let activeMetadata=0;
const metadataQueue:Array<()=>void>=[];
export async function loadTournamentMetadata(url:string, signal:AbortSignal):Promise<TournamentEventMetadata|null>{
  const cached=metadataCache.get(url);
  if(cached&&cached.expires>Date.now())return cached.value;
  if(activeMetadata>=2)await new Promise<void>(resolve=>metadataQueue.push(resolve));
  if(signal.aborted){metadataQueue.shift()?.();return null;}
  activeMetadata++;
  try{const result=await desktopApi.tournamentEventMetadata(url);metadataCache.set(url,{value:result,expires:Date.now()+(result.imageUrl?15*60_000:30_000)});if(metadataCache.size>120)metadataCache.delete(metadataCache.keys().next().value!);return signal.aborted?null:result;}
  finally{activeMetadata--;metadataQueue.shift()?.();}
}
