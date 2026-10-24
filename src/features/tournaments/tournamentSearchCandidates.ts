import type { TournamentDiscoveryRequest, TournamentDiscoveryResponse } from "@/features/tournaments/platform";
import { tournamentSearchSeeds } from "./tournamentSearch";

/** Recover candidates outside the source cap, then let the complete query rank them. */
export async function supplementTournamentCandidates(
  request: TournamentDiscoveryRequest,
  query: string,
  browse: TournamentDiscoveryResponse,
  fetch: (request: TournamentDiscoveryRequest) => Promise<TournamentDiscoveryResponse>,
  current: () => boolean,
  progress?: (response: TournamentDiscoveryResponse) => void,
): Promise<TournamentDiscoveryResponse> {
  if (!browse.sourceLimitReached || !query.trim() || !current()) return browse;
  const phrase=Array.from(query.trim().replace(/\s+/g," ")).slice(0,50).join("");
  const seeds=tournamentSearchSeeds(query,browse.events);
  const requests=[...new Set([phrase,...seeds].map(seed=>Array.from(seed).slice(0,50).join("")))].map(query=>({...request,query}));
  // A remembered venue may never occur in the title. Preserve an explicit city filter.
  if(!request.location&&seeds.length)requests.push({...request,query:"",location:seeds[0].slice(0,30)});
  const events=new Map(browse.events.map(event=>[event.tournamentId,event]));
  const response=():TournamentDiscoveryResponse=>({...browse,events:[...events.values()]});
  const errors:string[]=[];
  let next=0;
  async function worker(){
    while(current()&&next<requests.length){
      const scoped=requests[next++];
      try{
        const page=await fetch(scoped);
        if(!current())return;
        for(const event of page.events)events.set(event.tournamentId,event);
        progress?.(response());
      }catch(error){errors.push(error instanceof Error?error.message:String(error));}
    }
  }
  // Bounded concurrency, incremental display, and no new requests after cancellation.
  await Promise.all([worker(),worker()]);
  if(current()&&errors.length)throw new Error(`Some tournament searches failed. ${errors[0]}`);
  return response();
}
