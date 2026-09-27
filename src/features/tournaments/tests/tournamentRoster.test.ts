import { describe,expect,test } from "vitest";
import { createTournamentPrepRecord,parseTournamentPreps,serializeTournamentPreps,tournamentPrepDatabaseIds } from "../tournamentPrepStore";
import { mergeTournamentRoster,selectTournamentEntry } from "../tournamentRoster";
import { trackerFixture } from "./trackerFixture";

describe("following before entries",()=>{
  test("persists an empty event without inventing a personal entry",()=>{
    const snapshot={...trackerFixture().record.snapshot,players:[],pairings:[],phase:"registration" as const};
    const record=createTournamentPrepRecord(snapshot,null,2023);
    const saved=parseTournamentPreps(serializeTournamentPreps({[record.id]:record}))[record.id];
    expect(saved.userStartNumber).toBeNull();expect(saved.userName).toBe("");expect(saved.opponents).toEqual({});
    const updated=mergeTournamentRoster(saved,trackerFixture().record.snapshot).record;
    expect(updated.userStartNumber).toBeNull();expect(Object.keys(updated.opponents)).toHaveLength(updated.snapshot.players.length);
  });
  test("legacy selected entries and dates survive parsing",()=>{
    const record=trackerFixture().record;
    const parsed=parseTournamentPreps(serializeTournamentPreps({[record.id]:record}))[record.id];
    expect(parsed.userStartNumber).toBe(record.userStartNumber);expect(parsed.snapshot).toMatchObject(record.snapshot);
  });
  test("reconciles renumbered identities and retains imported games after withdrawal",()=>{
    const record=trackerFixture().record;
    const imported=Object.values(record.opponents).find(p=>p.collectionId!==null)!;
    const snapshot={...record.snapshot,players:record.snapshot.players.map(p=>({...p,startNumber:p.startNumber+50}))};
    const result=mergeTournamentRoster(record,snapshot).record;
    expect(tournamentPrepDatabaseIds(result)).toContain(imported.collectionId);
    expect(result.opponents[String(imported.startNumber+50)].collectionId).toBe(imported.collectionId);
    const removed=mergeTournamentRoster(result,{...snapshot,players:snapshot.players.filter(p=>p.name!==imported.name&&p.name!==record.userName)}).record;
    expect(removed.userStartNumber).toBeNull();expect(removed.userName).toBe(record.userName);
    expect(tournamentPrepDatabaseIds(removed)).toContain(imported.collectionId);
  });
  test("selecting an entry preserves its imported games and restores them when unselected",()=>{
    const record=trackerFixture().record;
    const imported=Object.values(record.opponents).find(p=>p.collectionId!==null)!;
    const player=record.snapshot.players.find(p=>p.startNumber===imported.startNumber)!;
    const selected=selectTournamentEntry(record,player);
    expect(selected.userStartNumber).toBe(player.startNumber);expect(selected.opponents[String(player.startNumber)]).toBeUndefined();
    expect(tournamentPrepDatabaseIds(selected)).toContain(imported.collectionId);
    const cleared=selectTournamentEntry(selected,null);
    expect(cleared.opponents[String(player.startNumber)].collectionId).toBe(imported.collectionId);
  });
  test("ambiguous identities cannot inherit another player's imported database",()=>{
    const record=trackerFixture().record;
    const imported=Object.values(record.opponents).find(p=>p.collectionId!==null)!;
    const player=record.snapshot.players.find(p=>p.startNumber===imported.startNumber)!;
    const result=mergeTournamentRoster(record,{...record.snapshot,players:[player,{...player,startNumber:999}]}).record;
    expect(result.opponents[String(player.startNumber)].collectionId).toBeNull();
    expect(result.opponents["999"].collectionId).toBeNull();expect(tournamentPrepDatabaseIds(result)).toContain(imported.collectionId);
  });
  test("new players remain new across polls until reviewed; failed snapshots retain the list",()=>{
    const record=createTournamentPrepRecord({...trackerFixture().record.snapshot,players:[]},null,2023);
    const next=mergeTournamentRoster(record,trackerFixture().record.snapshot).record;
    expect(mergeTournamentRoster(next,next.snapshot).record.seenPlayerKeys).toEqual([]);
    expect(()=>mergeTournamentRoster(next,{...next.snapshot,players:[],warnings:["Failed starting list"]})).toThrow("previous list");
  });
  test("newly published unique FIDE IDs retain self and imported games across renumbering",()=>{
    const initial=trackerFixture().record.snapshot;
    const snapshot={...initial,players:initial.players.map(p=>({...p,fideId:null}))};
    const record=createTournamentPrepRecord(snapshot,1,2023);
    record.opponents["2"]={...record.opponents["2"],collectionId:88,status:"ready",gameCount:12};
    const updated={...snapshot,players:snapshot.players.map(p=>({...p,startNumber:p.startNumber+20,fideId:String(9000+p.startNumber)}))};
    const next=mergeTournamentRoster(record,updated).record;
    expect(next).toMatchObject({userStartNumber:21,userFideId:"9001",userName:record.userName});
    expect(next.opponents["22"]).toMatchObject({collectionId:88,fideId:"9002",gameCount:12,status:"ready"});
    expect(next.retiredOpponents).toEqual([]);
    expect(next.seenPlayerKeys).toContain("fide:9001");expect(next.seenPlayerKeys).toContain("fide:9002");
    expect(next.seenPlayerKeys).toHaveLength(record.seenPlayerKeys!.length);
  });
  test("a conflicting published FIDE ID never inherits self or an imported database by name",()=>{
    const record=trackerFixture().record;
    const updated={...record.snapshot,players:record.snapshot.players.map(p=>({...p,fideId:`99${p.fideId}`}))};
    const next=mergeTournamentRoster(record,updated).record;
    expect(next.userStartNumber).toBeNull();
    expect(next.opponents["2"].collectionId).toBeNull();
    expect(next.retiredOpponents?.find(p=>p.collectionId===12)?.fideId).toBe("100001");
  });
  test("ambiguous new names cannot acquire a previously ID-less player's selection or games",()=>{
    const initial=trackerFixture().record.snapshot;
    const snapshot={...initial,players:initial.players.map(p=>({...p,fideId:null}))};
    const record=createTournamentPrepRecord(snapshot,1,2023);
    record.opponents["2"]={...record.opponents["2"],collectionId:88,status:"ready",gameCount:12};
    const duplicates=snapshot.players.slice(0,2).map((p,i)=>({...p,startNumber:91+i,fideId:String(91+i)}));
    const next=mergeTournamentRoster(record,{...snapshot,players:[...snapshot.players,...duplicates]}).record;
    expect(next.userStartNumber).toBeNull();
    expect(next.opponents["2"].collectionId).toBeNull();
    expect(next.opponents["92"].collectionId).toBeNull();
    expect(tournamentPrepDatabaseIds(next)).toContain(88);
  });
  test("a formerly ambiguous name does not become an identity match when one namesake leaves",()=>{
    const initial=trackerFixture().record.snapshot;
    const player={...initial.players[1],fideId:null};
    const snapshot={...initial,players:[initial.players[0],player,{...player,startNumber:20}]};
    const record=createTournamentPrepRecord(snapshot,1,2023);
    record.opponents["2"]={...record.opponents["2"],collectionId:88,status:"ready",gameCount:12};
    const next=mergeTournamentRoster(record,{...snapshot,players:[initial.players[0],{...player,startNumber:30,fideId:"333"}]}).record;
    expect(next.opponents["30"].collectionId).toBeNull();
    expect(tournamentPrepDatabaseIds(next)).toContain(88);
  });
  test("a known FIDE identity follows name corrections but never drops to name-only matching",()=>{
    const record=trackerFixture().record;
    const renamed={...record.snapshot,players:record.snapshot.players.map(p=>({...p,name:`Corrected ${p.name}`,startNumber:p.startNumber+20}))};
    const next=mergeTournamentRoster(record,renamed).record;
    expect(next.userStartNumber).toBe(21);expect(next.userName).toBe("Corrected Jordan Vale");
    expect(next.opponents["22"].collectionId).toBe(12);
    const missing=mergeTournamentRoster(next,{...renamed,players:renamed.players.map(p=>({...p,fideId:null}))}).record;
    expect(missing.userStartNumber).toBeNull();expect(missing.opponents["22"].collectionId).toBeNull();
    expect(tournamentPrepDatabaseIds(missing)).toContain(12);
  });
  test("the user's same-name entry also makes an old ID-less opponent ambiguous",()=>{
    const initial=trackerFixture().record.snapshot;
    const player={...initial.players[1],fideId:null};
    const snapshot={...initial,players:[{...player,startNumber:1},player]};
    const record=createTournamentPrepRecord(snapshot,1,2023);
    record.opponents["2"]={...record.opponents["2"],collectionId:88,status:"ready",gameCount:12};
    const next=mergeTournamentRoster(record,{...snapshot,players:[{...player,startNumber:30,fideId:"333"}]}).record;
    expect(next.userStartNumber).toBeNull();expect(next.opponents["30"].collectionId).toBeNull();
    expect(tournamentPrepDatabaseIds(next)).toContain(88);
  });
});
