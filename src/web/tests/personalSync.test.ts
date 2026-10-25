// @vitest-environment jsdom
import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {createHash,webcrypto} from "node:crypto";
import {makePgn,parsePgn} from "chessops/pgn";
import {createEmptyWebState} from "../storage";
import {createWebStateSession} from "../webStateSession";
import {createPersonalSync,syncMetadata,hasPersonalChanges,type PersonalSyncStatus} from "../personalSync";
import {parsePgnDatabase} from "../pgn";
import type {WebCompanionState} from "../model";

const raw=(note:string)=>`[Event "Fixture"]\n[Result "*"]\n\n1. e4 {${note}} (1. d4) e5 *`;
const stamp=(note:string,revision='one')=>{
 const game=parsePgn(raw(note))[0],body=makePgn(game);game.headers.set('PersonalSyncRef','database:1:1');game.headers.set('PersonalSyncRevision',revision);game.headers.set('PersonalSyncBase',createHash('sha256').update(body).digest('hex'));return makePgn(game);
};
const stateWith=(pgn=stamp('original'))=>{
 const parsed=parsePgnDatabase('Fixture',pgn,1),state=createEmptyWebState();state.personalSyncId='shared';state.databases=[parsed.database];state.gamesByDatabase[parsed.database.id]=parsed.games;return state;
};
async function fixture(state=stateWith()){
 let durable=state;const save=vi.fn(async(next:WebCompanionState)=>{durable=next;});
 const session=createWebStateSession({load:async()=>state,save});await session.load();
 const edit=(note:string)=>session.setState(current=>({...current,gamesByDatabase:{...current.gamesByDatabase,[state.databases[0].id]:current.gamesByDatabase[state.databases[0].id].map(g=>({...g,pgn:g.pgn.replace(/\{ (?:original|first|second) \}/,`{ ${note} }`)}))}}));
 const game=()=>session.getSnapshot().state.gamesByDatabase[state.databases[0].id][0];
 return{session,save,edit,game,durable:()=>durable};
}
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

test('canonical untouched games do not trigger uploads and transport metadata stays outside the content hash',async()=>{
 expect(await hasPersonalChanges(stamp('original'))).toBe(false);
 const f=await fixture();const writes:unknown[]=[];
 const sync=createPersonalSync({session:f.session,read:async<T>(url:string,body?:unknown)=>{if(body)writes.push(body);return(url==='status'?{enabled:true,id:'shared',phase:'synced'}:{ref:'database:1:1',revision:'one',pgn:stamp('original')}) as T;}});
 await sync.tick();expect(writes).toHaveLength(0);sync.stop();
});

test('an annotation made during an upload survives its acknowledgement and is sent on the next pass',async()=>{
 const f=await fixture();f.edit('first');let sends=0;
 const sync=createPersonalSync({session:f.session,read:async<T>(url:string,body?:unknown)=>{
  if(url==='status')return{enabled:true,id:'shared'} as T;
  if(body){sends++;if(sends===1)f.edit('second');return{ref:'database:1:1',revision:sends===1?'two':'three',pgn:stamp(sends===1?'first':'second',sends===1?'two':'three')} as T;}
  return{ref:'database:1:1',revision:'three',pgn:stamp('second','three')} as T;
 }});
 await sync.tick();expect(f.game().pgn).toContain('second');expect(syncMetadata(f.game().pgn)?.revision).toBe('two');expect(await hasPersonalChanges(f.game().pgn)).toBe(true);
 await sync.tick();expect(sends).toBe(2);expect(await hasPersonalChanges(f.game().pgn)).toBe(false);sync.stop();
});

test('offline and conflict failures retain durable phone edits and retry without choosing the PC version',async()=>{
 const f=await fixture();f.edit('first');let failing=true,last:PersonalSyncStatus={enabled:false};
 const sync=createPersonalSync({session:f.session,publish:s=>{last=s;},read:async<T>(url:string,body?:unknown)=>{
  if(url==='status')return{enabled:true,id:'shared'} as T;
  if(body&&failing)throw Error('This game changed on the PC. Your phone edits are preserved.');
  return{ref:'database:1:1',revision:'two',pgn:stamp('first','two')} as T;
 }});
 await sync.tick();expect(last.message).toContain('preserved');expect(f.durable().gamesByDatabase[f.game().databaseId][0].pgn).toContain('first');expect(syncMetadata(f.game().pgn)?.revision).toBe('one');
 failing=false;await sync.tick();expect(syncMetadata(f.game().pgn)?.revision).toBe('two');sync.stop();
});

test('remote updates refresh closed games but keep an open board snapshot intact',async()=>{
 const f=await fixture();const read=async<T>(url:string)=> (url==='status'?{enabled:true,id:'shared'}:{ref:'database:1:1',revision:'two',pgn:stamp('remote','two')}) as T;
 f.session.setState(s=>({...s,board:{...s.board,sourceGameId:f.game().id,sourceDatabaseId:f.game().databaseId}}));let last:PersonalSyncStatus={enabled:false};
 const sync=createPersonalSync({session:f.session,read,publish:s=>{last=s;}});await sync.tick();expect(f.game().pgn).toContain('original');expect(last.updateAvailable).toBe(true);
 f.session.setState(s=>({...s,board:{...s.board,sourceGameId:null,sourceDatabaseId:null}}));await sync.tick();expect(f.game().pgn).toContain('remote');sync.stop();
});

test('first connection preserves the old phone library before archiving it, and recovery failure stops adoption',async()=>{
 const state=stateWith(raw('original'));delete state.personalSyncId;const f=await fixture(state);let fail=true;
 const backup=vi.fn(async()=>{if(fail)throw Error('Recovery storage full');});
 const sync=createPersonalSync({session:f.session,backup,read:async<T>()=>({enabled:true,id:'shared'}) as T});
 await sync.tick();expect(f.session.getSnapshot().state.personalSyncId).toBeUndefined();expect(f.session.getSnapshot().state.sourceArchives).toBeUndefined();
 fail=false;await sync.tick();expect(backup).toHaveBeenCalledTimes(2);expect(f.session.getSnapshot().state.sourceArchives?.databaseIds).toContain(state.databases[0].id);expect(f.game().pgn).toContain('original');sync.stop();
});

test('a new phone import is linked without losing edits added while it uploads',async()=>{
 const f=await fixture(stateWith(raw('original')));let imported=0;
 const sync=createPersonalSync({session:f.session,read:async<T>(url:string,body?:unknown)=>{
  if(url==='status')return{enabled:true,id:'shared'} as T;
  if(url==='import'){imported++;f.edit('first');return{collection:1,name:'Fixture',games:[{ref:'database:1:1',revision:'one',pgn:stamp('original')}]} as T;}
  return{ref:'database:1:1',revision:'two',pgn:stamp('first','two')} as T;
 }});
 await sync.tick();expect(imported).toBe(1);expect(f.game().pgn).toContain('first');expect(await hasPersonalChanges(f.game().pgn)).toBe(false);sync.stop();
});
