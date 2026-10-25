import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {digest} from './files.mjs';

const schema=fs.readFileSync(new URL('../../src-tauri/src/db/create.sql',import.meta.url),'utf8');
const indexes=fs.readFileSync(new URL('../../src-tauri/src/db/indexes.sql',import.meta.url),'utf8');
const rowSql=`SELECT g.*,w.Name WhiteName,b.Name BlackName,e.Name EventName,s.Name SiteName FROM Games g JOIN Players w ON w.ID=g.WhiteID JOIN Players b ON b.ID=g.BlackID JOIN Events e ON e.ID=g.EventID JOIN Sites s ON s.ID=g.SiteID`;
export function rowHash(row){if(!row)return null;return digest(JSON.stringify({...row,Moves:Buffer.from(row.Moves).toString('hex')}));}
export function openEn(file,{create=false,name='Personal database',syncId=null}={}){
  if(!create && !fs.existsSync(file))throw Error(`Database missing: ${file}`);
  const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
  if(create){db.exec(schema);db.exec(indexes);for(const [key,value] of Object.entries({Version:'1.0.0',Title:name,Description:'Personal chess library',GameCount:'0',PlayerCount:'1',EventCount:'1',SiteCount:'1',...(syncId?{PersonalSyncId:syncId}:{})}))db.prepare('INSERT INTO Info(Name,Value) VALUES(?,?)').run(key,value);}
  return db;
}
export const enRows=db=>db.prepare(rowSql+' ORDER BY g.ID').all();
export const enRow=(db,id)=>db.prepare(rowSql+' WHERE g.ID=?').get(id);
export function encodedMatches(row,encoded){
  if(!row)return false;
  const h=encoded.headers;
  const expected={EventName:h.Event||'Unknown',SiteName:h.Site||'Unknown',WhiteName:h.White||'Unknown',BlackName:h.Black||'Unknown',Date:h.Date??h.UTCDate??null,UTCTime:h.UTCTime??null,Round:h.Round??null,WhiteElo:numeric(h.WhiteElo),BlackElo:numeric(h.BlackElo),Result:h.Result??'*',TimeControl:h.TimeControl??null,ECO:h.ECO??null,FEN:h.FEN??null};
  return Object.entries(expected).every(([key,value])=>value===null?row[key]===null:String(row[key])===String(value)) && Buffer.from(row.Moves).toString('hex')===encoded.moves;
}
export function refreshCounts(db){for(const [key,table] of Object.entries({GameCount:'Games',PlayerCount:'Players',EventCount:'Events',SiteCount:'Sites'}))db.prepare('INSERT INTO Info(Name,Value) VALUES(?,?) ON CONFLICT(Name) DO UPDATE SET Value=excluded.Value').run(key,String(db.prepare(`SELECT count(*) n FROM ${table}`).get().n));}
function namedId(db,table,name){if(!name)return 0;db.prepare(`INSERT OR IGNORE INTO ${table}(Name) VALUES(?)`).run(name);return db.prepare(`SELECT ID FROM ${table} WHERE Name=?`).get(name).ID;}
const numeric=v=>v && /^\d+$/.test(v)?Number(v):null;
export function writeEncoded(db,{id,encoded,expected}){
  if(rowHash(enRow(db,id))!==expected)throw Error(`Concurrent database edit: game ${id}`);
  const h=encoded.headers;
  const fields={EventID:namedId(db,'Events',h.Event),SiteID:namedId(db,'Sites',h.Site),Date:h.Date??h.UTCDate??null,UTCTime:h.UTCTime??null,Round:h.Round??null,WhiteID:namedId(db,'Players',h.White),WhiteElo:numeric(h.WhiteElo),BlackID:namedId(db,'Players',h.Black),BlackElo:numeric(h.BlackElo),WhiteMaterial:encoded.whiteMaterial,BlackMaterial:encoded.blackMaterial,Result:h.Result??'*',TimeControl:h.TimeControl??null,ECO:h.ECO??null,PlyCount:encoded.plyCount,FEN:h.FEN??null,Moves:Buffer.from(encoded.moves,'hex'),PawnHome:encoded.pawnHome};
  if(expected===null){db.prepare(`INSERT INTO Games(ID,${Object.keys(fields).join(',')}) VALUES(${new Array(Object.keys(fields).length+1).fill('?').join(',')})`).run(id,...Object.values(fields));}
  else{db.prepare(`UPDATE Games SET ${Object.keys(fields).map(k=>k+'=?').join(',')} WHERE ID=?`).run(...Object.values(fields),id);}
  return rowHash(enRow(db,id));
}
export function transaction(db,work){db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
export async function pgnFromRow(row,codec,original=''){
  const headers=new Map([...original.matchAll(/^\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)].map(m=>[m[1],m[2].replace(/\\([\\"])/g,'$1')]));
  const updated={Event:row.EventName,Site:row.SiteName,Date:row.Date,UTCTime:row.UTCTime,Round:row.Round,White:row.WhiteName,Black:row.BlackName,WhiteElo:row.WhiteElo,BlackElo:row.BlackElo,Result:row.Result??'*',TimeControl:row.TimeControl,ECO:row.ECO,FEN:row.FEN};
  for(const [key,value]of Object.entries(updated)){if(value===null||value===undefined)headers.delete(key);else headers.set(key,String(value));}
  if(row.FEN)headers.set('SetUp','1');else headers.delete('SetUp');
  const decoded=await codec.request({moves:Buffer.from(row.Moves).toString('hex'),fen:row.FEN});
  const escape=s=>s.replaceAll('\\','\\\\').replaceAll('"','\\"');
  return [...headers].map(([key,value])=>`[${key} "${escape(value)}"]`).join('\n')+'\n\n'+decoded.movetext+' '+(row.Result??'*')+'\n';
}
