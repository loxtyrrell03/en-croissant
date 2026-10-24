import type { TournamentDiscoveryRequest, TournamentDiscoveryResponse } from "@/features/tournaments/platform";

/** Coalesce a directory read while typing; share successful fragment lookups too. */
export function createTournamentSearchCache(fetch:(request:TournamentDiscoveryRequest)=>Promise<TournamentDiscoveryResponse>){
  const values=new Map<string,{response:TournamentDiscoveryResponse;expires:number}>();
  const pending=new Map<string,Promise<TournamentDiscoveryResponse>>();
  return {
    clear(){values.clear();pending.clear();},
    read(request:TournamentDiscoveryRequest){
      const key=JSON.stringify(request),cached=values.get(key);
      if(cached&&cached.expires>Date.now())return Promise.resolve(cached.response);
      const running=pending.get(key);if(running)return running;
      const promise=Promise.resolve().then(()=>fetch(request)).then(response=>{
        if(pending.get(key)===promise){
          values.set(key,{response,expires:Date.now()+5*60_000});
          if(values.size>60)values.delete(values.keys().next().value!);
        }
        return response;
      }).finally(()=>{if(pending.get(key)===promise)pending.delete(key);});
      pending.set(key,promise);return promise;
    },
  };
}
