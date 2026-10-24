import { afterEach, describe, expect, test, vi } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";

function protocolPlayers(size: number): TournamentSnapshot["players"] {
  return Array.from({ length: size }, (_, index) => ({
    startNumber: index + 1, name: `Player ${index + 1}`, fideId: null, federation: null,
    title: null, rating: 2400 - index, rank: index + 1, points: 2.5, active: true,
  }));
}

/** Complete synthetic history keeps queue/timeout tests past source admission.
 * Workers below are controlled transport fakes; no Swiss solver runs here. */
function protocolHistory(size: number): TournamentSnapshot["pairings"] {
  const seats: (number | null)[] = Array.from({ length: size }, (_, index) => index + 1);
  if (seats.length % 2) seats.push(null);
  const rows: TournamentSnapshot["pairings"] = [];
  for (let round = 1; round <= 5; round++) {
    for (let board = 0; board < seats.length / 2; board++) {
      const first = seats[board], second = seats[seats.length - 1 - board];
      rows.push({ round, board: board + 1, whiteStartNumber: first ?? second,
        blackStartNumber: first === null ? null : second, whitePoints: (round - 1) / 2,
        blackPoints: second === null || first === null ? null : (round - 1) / 2,
        result: first === null || second === null ? "1/2" : "1/2-1/2", decided: true });
    }
    seats.splice(1, 0, seats.pop()!);
  }
  return rows;
}

const snapshot: TournamentSnapshot = {
  tournamentId: "timeout-test",
  sourceUrl: "https://chess-results.com/tnr1.aspx?lan=1",
  title: "Timeout test",
  section: "Open",
  format: "swiss",
  formatLabel: "Swiss",
  totalRounds: 9,
  completedRound: 5,
  publishedRound: 5,
  liveRound: null,
  nextRound: 6,
  phase: "between-rounds",
  dateRange: null,
  timeControl: null,
  sourceUpdatedAt: null,
  fetchedAt: "2026-08-06T18:00:00Z",
  players: protocolPlayers(20),
  pairings: protocolHistory(20),
  warnings: [],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("exact Swiss worker client", () => {
  test("gives uncapped large fields enough background solve time", async () => {
    const {
      exactSwissWorkerTimeoutMs,
      EXACT_SWISS_WORKER_TIMEOUT_MS,
      HUGE_EXACT_SWISS_WORKER_TIMEOUT_MS,
      LARGE_EXACT_SWISS_WORKER_TIMEOUT_MS,
    } = await import("../exactSwissForecastClient");
    expect(exactSwissWorkerTimeoutMs(field(260), 6)).toBe(
      EXACT_SWISS_WORKER_TIMEOUT_MS,
    );
    expect(exactSwissWorkerTimeoutMs(field(261), 6)).toBe(
      LARGE_EXACT_SWISS_WORKER_TIMEOUT_MS,
    );
    expect(exactSwissWorkerTimeoutMs(field(331), 6)).toBe(
      HUGE_EXACT_SWISS_WORKER_TIMEOUT_MS,
    );
  });

  test("terminates a pathological solve and returns the fallback result", async () => {
    vi.useFakeTimers();
    let terminated = false;
    class SilentWorker {
      addEventListener(): void {}
      postMessage(): void {}
      terminate(): void {
        terminated = true;
      }
    }
    vi.stubGlobal("Worker", SilentWorker);
    const { EXACT_SWISS_WORKER_TIMEOUT_MS, requestExactSwissForecast } = await import(
      "../exactSwissForecastClient"
    );

    const forecast = requestExactSwissForecast(snapshot, 6, 1);
    await vi.advanceTimersByTimeAsync(EXACT_SWISS_WORKER_TIMEOUT_MS);

    await expect(forecast).resolves.toBeNull();
    expect(terminated).toBe(true);
  });

  test("routes an explicitly named pairing system to the worker", async () => {
    let sent: Record<string, unknown> | null = null;
    const listeners = new Map<string, (event: MessageEvent) => void>();
    class ResponsiveWorker {
      addEventListener(type: string, listener: (event: MessageEvent) => void): void {
        listeners.set(type, listener);
      }
      postMessage(message: Record<string, unknown>): void {
        sent = message;
        queueMicrotask(() =>
          listeners.get("message")?.({
            data: {
              id: message.id,
              forecasts: { 1: {
                opponentStartNumber: 2,
                color: "white",
                estimatedLiveResults: false,
                system: message.system,
                acceleration: null,
              } },
            },
          } as MessageEvent),
        );
      }
      terminate(): void {}
    }
    vi.stubGlobal("Worker", ResponsiveWorker);
    const { requestExactSwissForecast } = await import("../exactSwissForecastClient");

    const forecast = await requestExactSwissForecast(
      { ...snapshot, tournamentId: "dubov-test", formatLabel: "Swiss-System (Dubov)" },
      6,
      1,
    );

    expect(sent).toMatchObject({ system: "dubov" });
    expect(forecast?.system).toBe("dubov");
  });
});

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  listeners = new Map<string, (event: MessageEvent) => void>();
  sent!: Record<string, any>;
  terminated = false;
  constructor() { ControlledWorker.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent) => void): void { this.listeners.set(type, listener); }
  postMessage(message: Record<string, any>): void { this.sent = message; }
  terminate(): void { this.terminated = true; }
  answer(opponent = 2): void {
    this.listeners.get("message")?.({ data: { id: this.sent.id, forecasts: Object.fromEntries(Array.from({length:20},(_,i)=>[i+1,{
      opponentStartNumber: opponent, color: "white", estimatedLiveResults: false,
      system: "dutch", acceleration: null,
    }])) } } as MessageEvent);
  }
}
function controlWorkers(): void {
  vi.useFakeTimers(); ControlledWorker.instances = [];
  vi.stubGlobal("Worker", ControlledWorker);
}
function field(size: number): TournamentSnapshot {
  return { ...snapshot, players: protocolPlayers(size), pairings: protocolHistory(size) };
}

test("a small-event timeout cannot cancel a large-event solve", async () => {
  controlWorkers();
  const { requestExactSwissForecast } = await import("../exactSwissForecastClient");
  const small = requestExactSwissForecast(snapshot,6,1);
  const large = requestExactSwissForecast(field(350),6,1);
  await vi.advanceTimersByTimeAsync(75_000);
  await expect(small).resolves.toBeNull();
  expect(ControlledWorker.instances[1].terminated).toBe(false);
  ControlledWorker.instances[1].answer(3);
  await expect(large).resolves.toMatchObject({opponentStartNumber:3});
  expect(vi.getTimerCount()).toBe(0);
});

test("queue starts the full solve budget only at dispatch and deduplicates", async () => {
  controlWorkers();
  const { requestExactSwissForecast } = await import("../exactSwissForecastClient");
  const a=requestExactSwissForecast(snapshot,6,1), b=requestExactSwissForecast({...snapshot,tournamentId:'b'},6,2);
  const third={...snapshot,tournamentId:'c'};
  const c=requestExactSwissForecast(third,6,3);
  const duplicate=requestExactSwissForecast(structuredClone(third),6,3);
  expect(ControlledWorker.instances).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(50_000);
  ControlledWorker.instances[0].answer(); await a;
  expect(ControlledWorker.instances).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(25_000);
  await expect(b).resolves.toBeNull();
  expect(ControlledWorker.instances[2].terminated).toBe(false);
  await vi.advanceTimersByTimeAsync(49_999);
  expect(ControlledWorker.instances[2].terminated).toBe(false);
  ControlledWorker.instances[2].answer(4);
  await expect(c).resolves.toMatchObject({opponentStartNumber:4});
  expect(await duplicate).toBe(await c);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["error", "messageerror"])("%s is isolated and releases its queue slot", async (type) => {
  controlWorkers();
  const { requestExactSwissForecast } = await import("../exactSwissForecastClient");
  const a=requestExactSwissForecast(snapshot,6,1), b=requestExactSwissForecast({...snapshot,tournamentId:'b'},6,2);
  const c=requestExactSwissForecast({...snapshot,tournamentId:'c'},6,3);
  ControlledWorker.instances[0].listeners.get(type)?.({} as MessageEvent);
  await expect(a).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(3);
  expect(ControlledWorker.instances[1].terminated).toBe(false);
  ControlledWorker.instances[1].answer(); ControlledWorker.instances[2].answer();
  await Promise.all([b,c]); expect(vi.getTimerCount()).toBe(0);
});

test("queue overflow and wait expiry return fallback without killing active work", async () => {
  controlWorkers();
  const { requestExactSwissForecast } = await import("../exactSwissForecastClient");
  const inputs=Array.from({length:11},(_,i)=>requestExactSwissForecast({...field(350),tournamentId:String(i)},6,i+1));
  await expect(inputs[10]).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(75_000);
  expect(await Promise.all(inputs.slice(2,10))).toEqual(Array(8).fill(null));
  expect(ControlledWorker.instances.every(w=>!w.terminated)).toBe(true);
  ControlledWorker.instances.forEach(w=>w.answer()); await Promise.all(inputs);
  expect(vi.getTimerCount()).toBe(0);
});

test("same-timestamp changes invalidate cached forecasts and queued snapshots stay immutable", async () => {
  controlWorkers();
  const { requestExactSwissForecast, exactSwissForecastKey } = await import("../exactSwissForecastClient");
  const original=field(4), changed=structuredClone(original);
  changed.evidenceVersion=1;
  changed.roundStatus=[{round:6,startNumber:1,kind:"not-paired",award:null}];
  expect(exactSwissForecastKey(original,6,1)).not.toBe(exactSwissForecastKey(changed,6,1));
  const a=requestExactSwissForecast(original,6,1), b=requestExactSwissForecast({...original,tournamentId:'b'},6,2);
  const c=requestExactSwissForecast(changed,6,3);
  changed.roundStatus=[];
  ControlledWorker.instances[0].answer(); await a;
  expect(ControlledWorker.instances[2].sent.snapshot.roundStatus).toEqual([{round:6,startNumber:1,kind:"not-paired",award:null}]);
  ControlledWorker.instances[1].answer(); ControlledWorker.instances[2].answer(); await Promise.all([b,c]);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["construct", "post"])("%s failure settles without leaking timers", async (failure) => {
  vi.useFakeTimers();
  class BrokenWorker {
    constructor() { if(failure==="construct") throw new Error("no worker"); }
    addEventListener(): void {}
    postMessage(): void { throw new Error("clone failed"); }
    terminate(): void {}
  }
  vi.stubGlobal("Worker", BrokenWorker);
  const { requestExactSwissForecast } = await import("../exactSwissForecastClient");
  await expect(requestExactSwissForecast(snapshot,6,1)).resolves.toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});


test("known incomplete earlier rounds decline reconstruction without creating a worker",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import("../exactSwissForecastClient");
  await expect(requestExactSwissForecast({...snapshot,incompletePairingRounds:[2]},6,1)).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(0);
});

test("different selected players share one whole-field solve and retain their own results",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const s=field(4),a=requestExactSwissForecast(s,6,1),b=requestExactSwissForecast(structuredClone(s),6,2);
  expect(ControlledWorker.instances).toHaveLength(1);
  const worker=ControlledWorker.instances[0];
  const forecasts={1:{opponentStartNumber:3,color:'white',system:'dutch',acceleration:null,estimatedLiveResults:false},
    2:{opponentStartNumber:4,color:'black',system:'dutch',acceleration:null,estimatedLiveResults:false}};
  worker.listeners.get('message')?.({data:{id:worker.sent.id,forecasts}} as MessageEvent);
  await expect(a).resolves.toMatchObject({opponentStartNumber:3});
  await expect(b).resolves.toMatchObject({opponentStartNumber:4});
  await expect(requestExactSwissForecast(s,6,2)).resolves.toBe(forecasts[2]);
  await expect(requestExactSwissForecast(s,6,99)).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});


test("an already-aborted subscriber creates no worker, timer, or cached failure",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const controller=new AbortController();controller.abort();
  await expect(requestExactSwissForecast(snapshot,6,1,controller.signal)).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);
  const retry=requestExactSwissForecast(snapshot,6,1);
  expect(ControlledWorker.instances).toHaveLength(1);ControlledWorker.instances[0].answer();await retry;
});

test.each([true,false])("cancelling one same-field subscriber preserves the other (cancellable survivor: %s)",async(cancellable)=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const aControl=new AbortController(),bControl=new AbortController();
  const a=requestExactSwissForecast(snapshot,6,1,aControl.signal);
  const b=requestExactSwissForecast(structuredClone(snapshot),6,2,cancellable?bControl.signal:undefined);
  aControl.abort();await expect(a).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(1);expect(ControlledWorker.instances[0].terminated).toBe(false);
  const worker=ControlledWorker.instances[0];const forecasts={2:{opponentStartNumber:4,color:'black',system:'dutch',acceleration:null,estimatedLiveResults:false}};
  worker.listeners.get('message')?.({data:{id:worker.sent.id,forecasts}} as MessageEvent);
  await expect(b).resolves.toBe(forecasts[2]);
  await expect(requestExactSwissForecast(snapshot,6,2)).resolves.toBe(forecasts[2]);
  expect(vi.getTimerCount()).toBe(0);
});

test("same-tick selection cleanup and resubscription retain the worker and full-field result",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const oldControl=new AbortController(),newControl=new AbortController();
  const previous=requestExactSwissForecast(snapshot,6,1,oldControl.signal);
  oldControl.abort();
  const next=requestExactSwissForecast(structuredClone(snapshot),6,2,newControl.signal);
  await expect(previous).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(1);expect(ControlledWorker.instances[0].terminated).toBe(false);
  ControlledWorker.instances[0].answer(4);await expect(next).resolves.toMatchObject({opponentStartNumber:4});
  expect(vi.getTimerCount()).toBe(0);
});

test("last active subscriber cancellation frees only its worker and permits an immediate clean retry",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const control=new AbortController();const old=requestExactSwissForecast(snapshot,6,1,control.signal);
  const other=requestExactSwissForecast({...snapshot,tournamentId:'other'},6,1);
  control.abort();await expect(old).resolves.toBeNull();
  expect(ControlledWorker.instances[0].terminated).toBe(true);expect(ControlledWorker.instances[1].terminated).toBe(false);
  const retry=requestExactSwissForecast(snapshot,6,1);const received=vi.fn();void retry.then(received);
  expect(ControlledWorker.instances).toHaveLength(3);
  // Terminated workers may already have a callback queued. It cannot resolve
  // the new request or replace the eventual result in the whole-field cache.
  ControlledWorker.instances[0].answer(99);ControlledWorker.instances[0].listeners.get('error')?.({} as MessageEvent);
  await Promise.resolve();expect(received).not.toHaveBeenCalled();
  ControlledWorker.instances[2].answer(5);await expect(retry).resolves.toMatchObject({opponentStartNumber:5});
  ControlledWorker.instances[1].answer();await other;
  await expect(requestExactSwissForecast(snapshot,6,1)).resolves.toMatchObject({opponentStartNumber:5});
  expect(ControlledWorker.instances).toHaveLength(3);expect(vi.getTimerCount()).toBe(0);
});

test.each(['message','error'])("an abandoned request's %s during cancellation grace cannot cache a result",async(type)=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const controller=new AbortController();const old=requestExactSwissForecast(snapshot,6,1,controller.signal);
  controller.abort();
  if(type==='message')ControlledWorker.instances[0].answer(99);
  else ControlledWorker.instances[0].listeners.get('error')?.({} as MessageEvent);
  await expect(old).resolves.toBeNull();
  const retry=requestExactSwissForecast(snapshot,6,1);
  expect(ControlledWorker.instances).toHaveLength(2);ControlledWorker.instances[1].answer(6);
  await expect(retry).resolves.toMatchObject({opponentStartNumber:6});expect(vi.getTimerCount()).toBe(0);
});

test("cancelled queued work is skipped when a worker frees before the cancellation microtask",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const a=requestExactSwissForecast(snapshot,6,1),b=requestExactSwissForecast({...snapshot,tournamentId:'b'},6,1);
  const controller=new AbortController();
  const c=requestExactSwissForecast({...snapshot,tournamentId:'cancelled'},6,1,controller.signal);
  const d=requestExactSwissForecast({...snapshot,tournamentId:'next'},6,1);
  controller.abort();ControlledWorker.instances[0].answer();
  // The queue head is abandoned; it must not start just because A completed.
  expect(ControlledWorker.instances).toHaveLength(2);
  await expect(c).resolves.toBeNull();await a;
  expect(ControlledWorker.instances).toHaveLength(3);
  expect(ControlledWorker.instances[2].sent.snapshot.tournamentId).toBe('next');
  ControlledWorker.instances[1].answer();ControlledWorker.instances[2].answer();await Promise.all([b,d]);
  expect(vi.getTimerCount()).toBe(0);
});

test("a queued field survives cancellation of one subscriber and keeps FIFO dispatch",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const a=requestExactSwissForecast(snapshot,6,1),b=requestExactSwissForecast({...snapshot,tournamentId:'b'},6,1);
  const controller=new AbortController(),queued={...snapshot,tournamentId:'shared-queued'};
  const cancelled=requestExactSwissForecast(queued,6,1,controller.signal);
  const survivor=requestExactSwissForecast(structuredClone(queued),6,2);
  const last=requestExactSwissForecast({...snapshot,tournamentId:'last'},6,3);
  controller.abort();await expect(cancelled).resolves.toBeNull();
  ControlledWorker.instances[0].answer();await a;
  expect(ControlledWorker.instances[2].sent.snapshot.tournamentId).toBe('shared-queued');
  ControlledWorker.instances[2].answer(4);await expect(survivor).resolves.toMatchObject({opponentStartNumber:4});
  expect(ControlledWorker.instances[3].sent.snapshot.tournamentId).toBe('last');
  ControlledWorker.instances[1].answer();ControlledWorker.instances[3].answer();await Promise.all([b,last]);expect(vi.getTimerCount()).toBe(0);
});

test("cancelled queue entries restore bounded queue capacity without interrupting active fields",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const controllers=Array.from({length:10},()=>new AbortController());
  const pending=controllers.map((c,i)=>requestExactSwissForecast({...field(350),tournamentId:String(i)},6,1,c.signal));
  await expect(requestExactSwissForecast({...snapshot,tournamentId:'overflow'},6,1)).resolves.toBeNull();
  controllers[2].abort();await expect(pending[2]).resolves.toBeNull();
  const replacement=requestExactSwissForecast({...snapshot,tournamentId:'replacement'},6,1);
  expect(ControlledWorker.instances).toHaveLength(2);expect(ControlledWorker.instances.every(w=>!w.terminated)).toBe(true);
  // Drain the surviving FIFO queue and its replacement. No cancelled field
  // should consume a worker when earlier computations finish.
  for(let index=0;index<10;index++){const worker=ControlledWorker.instances[index];if(worker)worker.answer();}
  await Promise.all([...pending,replacement]);
  expect(ControlledWorker.instances).toHaveLength(10);
  expect(ControlledWorker.instances.some(w=>w.sent.snapshot.tournamentId==='2')).toBe(false);
  expect(ControlledWorker.instances.at(-1)?.sent.snapshot.tournamentId).toBe('replacement');expect(vi.getTimerCount()).toBe(0);
});

test("normal completion removes abort listeners and abort after completion preserves the cache",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const controller=new AbortController(),remove=vi.spyOn(controller.signal,'removeEventListener');
  const result=requestExactSwissForecast(snapshot,6,1,controller.signal);ControlledWorker.instances[0].answer(7);
  await expect(result).resolves.toMatchObject({opponentStartNumber:7});expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));
  controller.abort();await Promise.resolve();
  await expect(requestExactSwissForecast(snapshot,6,1)).resolves.toMatchObject({opponentStartNumber:7});
  expect(ControlledWorker.instances).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
});

test("ordinary uncancelled solver failure retains the existing cached-fallback behavior",async()=>{
  controlWorkers();
  const {requestExactSwissForecast}=await import('../exactSwissForecastClient');
  const pending=requestExactSwissForecast(snapshot,6,1);ControlledWorker.instances[0].listeners.get('error')?.({} as MessageEvent);
  await expect(pending).resolves.toBeNull();await expect(requestExactSwissForecast(snapshot,6,2)).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
});

test("observation-only refreshes share pending and successful field work", async () => {
  controlWorkers();
  const { requestExactSwissForecast, exactSwissForecastKey } = await import('../exactSwissForecastClient');
  const original = field(4), refreshed = { ...original, fetchedAt: 'later fetch', sourceUpdatedAt: 'later upload' };
  expect(exactSwissForecastKey(refreshed, 6)).toBe(exactSwissForecastKey(original, 6));
  const a = requestExactSwissForecast(original, 6, 1), b = requestExactSwissForecast(refreshed, 6, 2);
  expect(ControlledWorker.instances).toHaveLength(1);
  expect(ControlledWorker.instances[0].sent.snapshot.fetchedAt).toBe(original.fetchedAt);
  ControlledWorker.instances[0].answer(7);
  await expect(a).resolves.toMatchObject({ opponentStartNumber: 7 });
  await expect(b).resolves.toMatchObject({ opponentStartNumber: 7 });
  await expect(requestExactSwissForecast({ ...refreshed, fetchedAt: 'third fetch' }, 6, 3)).resolves.toMatchObject({ opponentStartNumber: 7 });
  expect(ControlledWorker.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("failed work is cached only through the latest observed refresh and retries on the next fetch", async () => {
  controlWorkers();
  const { requestExactSwissForecast } = await import('../exactSwissForecastClient');
  const a = requestExactSwissForecast(snapshot, 6, 1);
  const second = { ...snapshot, fetchedAt: 'second fetch' };
  const b = requestExactSwissForecast(second, 6, 2);
  ControlledWorker.instances[0].listeners.get('error')?.({} as MessageEvent);
  await expect(a).resolves.toBeNull(); await expect(b).resolves.toBeNull();
  await expect(requestExactSwissForecast(second, 6, 1)).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(1);
  const c = requestExactSwissForecast({ ...second, fetchedAt: 'third fetch' }, 6, 1);
  expect(ControlledWorker.instances).toHaveLength(2);
  ControlledWorker.instances[0].answer(19);
  ControlledWorker.instances[1].answer(4);
  await expect(c).resolves.toMatchObject({ opponentStartNumber: 4 });
  expect(vi.getTimerCount()).toBe(0);
});

test("metadata refresh does not reset the original solve deadline", async () => {
  controlWorkers();
  const { requestExactSwissForecast } = await import('../exactSwissForecastClient');
  const a = requestExactSwissForecast(snapshot, 6, 1);
  await vi.advanceTimersByTimeAsync(50_000);
  const later = { ...snapshot, fetchedAt: 'later' };
  const b = requestExactSwissForecast(later, 6, 2);
  expect(ControlledWorker.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(25_000);
  await expect(a).resolves.toBeNull(); await expect(b).resolves.toBeNull();
  await expect(requestExactSwissForecast(later, 6, 2)).resolves.toBeNull();
  expect(ControlledWorker.instances[0].terminated).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test("refresh-stable identity still includes every substantive snapshot field", async () => {
  const { exactSwissForecastKey } = await import('../exactSwissForecastClient');
  const original = field(4), key = exactSwissForecastKey(original, 6);
  for (const change of [
    (s: TournamentSnapshot) => { s.players[0].rating = 2500; },
    (s: TournamentSnapshot) => { s.players[0].points = 1; },
    (s: TournamentSnapshot) => { s.players[0].active = false; },
    (s: TournamentSnapshot) => { s.players[0].notPairedRounds = [6]; },
    (s: TournamentSnapshot) => { s.players[0].halfPointByeRounds = [5]; },
    (s: TournamentSnapshot) => { s.incompletePairingRounds = [3]; },
    (s: TournamentSnapshot) => { s.formatLabel = 'Swiss (Baku)'; },
    (s: TournamentSnapshot) => { s.title = 'Baku acceleration'; },
    (s: TournamentSnapshot) => { s.totalRounds = 10; },
    (s: TournamentSnapshot) => { s.liveRound = 5; },
    (s: TournamentSnapshot) => { s.pairings = [{ round: 5, board: 1, whiteStartNumber: 1, blackStartNumber: 2, whitePoints: 0, blackPoints: 0, result: '1-0', decided: true }]; },
  ]) {
    const next = structuredClone(original); change(next);
    expect(exactSwissForecastKey(next, 6)).not.toBe(key);
  }
  expect(exactSwissForecastKey(original, 7)).not.toBe(key);
});

test("a metadata refresh shares a queued job without extending its wait bound", async () => {
  controlWorkers();
  const { requestExactSwissForecast } = await import('../exactSwissForecastClient');
  const controllers = [new AbortController(), new AbortController()];
  const active = controllers.map((c, i) => requestExactSwissForecast({ ...field(350), tournamentId: `active-${i}` }, 6, 1, c.signal));
  const queued = requestExactSwissForecast(snapshot, 6, 1);
  await vi.advanceTimersByTimeAsync(50_000);
  const refreshed = requestExactSwissForecast({ ...snapshot, fetchedAt: 'new' }, 6, 2);
  await vi.advanceTimersByTimeAsync(25_000);
  await expect(queued).resolves.toBeNull(); await expect(refreshed).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(2);
  controllers.forEach(c => c.abort()); await Promise.all(active); await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});


test.each(["missing-history", "legacy-absence", "adjusted-total"])("%s refuses before creating transport work", async (kind) => {
  controlWorkers();
  const { requestExactSwissForecast } = await import("../exactSwissForecastClient");
  const input = field(4);
  if (kind === "missing-history") input.pairings = input.pairings.filter(row => row.round !== 1);
  if (kind === "legacy-absence") input.players[0].notPairedRounds = [6];
  if (kind === "adjusted-total") {
    input.evidenceVersion = 1;
    Object.assign(input.players[0], { points: 3, scoreKnown: true, scoreRound: 5, scoreSource: "published" });
  }
  await expect(requestExactSwissForecast(input, 6, 1)).resolves.toBeNull();
  expect(ControlledWorker.instances).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});
