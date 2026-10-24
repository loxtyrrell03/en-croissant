import {afterEach,expect,test,vi} from "vitest";
import {createTournamentSearchCache} from "../tournamentSearchCache";
import {defaultDiscoveryFilters,discoveryRequest} from "../tournamentDiscoveryModel";
import type {TournamentDiscoveryResponse} from "@/features/tournaments/platform";
const request=discoveryRequest(defaultDiscoveryFilters());
const response:TournamentDiscoveryResponse={events:[],sourceCount:0,sourceLimitReached:false,fetchedAt:"2026-10-24"};
afterEach(()=>vi.useRealTimers());
test("typing reuses the same in-flight browse and successful reads expire",async()=>{
  vi.useFakeTimers();let finish!:(value:TournamentDiscoveryResponse)=>void;
  const fetch=vi.fn(()=>new Promise<TournamentDiscoveryResponse>(resolve=>{finish=resolve;}));
  const cache=createTournamentSearchCache(fetch);const a=cache.read(request),b=cache.read({...request});
  expect(a).toBe(b);await Promise.resolve();expect(fetch).toHaveBeenCalledTimes(1);
  finish(response);await a;expect(await cache.read(request)).toBe(response);expect(fetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5*60_000+1);const next=cache.read(request);await Promise.resolve();finish(response);await next;
  expect(fetch).toHaveBeenCalledTimes(2);
});
test("source failures can be retried and different filters never share results",async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(Error("Offline")).mockResolvedValue(response);
  const cache=createTournamentSearchCache(fetch);
  await expect(cache.read(request)).rejects.toThrow("Offline");await cache.read(request);
  await cache.read({...request,country:"WLS"});expect(fetch).toHaveBeenCalledTimes(3);
});
test("an old in-flight read cannot refill a cleared cache",async()=>{
  const release:Array<(value:TournamentDiscoveryResponse)=>void>=[];
  const fetch=vi.fn(()=>new Promise<TournamentDiscoveryResponse>(resolve=>release.push(resolve)));
  const cache=createTournamentSearchCache(fetch),old=cache.read(request);await Promise.resolve();cache.clear();
  const fresh=cache.read(request);await Promise.resolve();release[1]({...response,sourceCount:2});await fresh;
  release[0](response);await old;expect((await cache.read(request)).sourceCount).toBe(2);
});
