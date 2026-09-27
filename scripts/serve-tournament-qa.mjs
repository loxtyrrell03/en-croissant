// Local, synthetic UI exercise. No production profile, native imports or network downloads.
import { createServer } from "vite";
import { buildWebOtbPrepDatabase } from "./generated/otb-prep-database.js";
const settings=new Map(),collections=new Map(),jobs=new Map();let nextId=1;const names=["Jordan Vale","Alex Morgan","Sam Rivera","Jamie Chen","Robin Ellis","Casey Bell","Taylor Reed"];
const fixture={tournamentId:"42",sourceUrl:"https://chess-results.com/tnr42.aspx",title:"Synthetic tournament · QA only",section:"Open",format:"swiss",formatLabel:"Swiss-System",totalRounds:7,completedRound:4,publishedRound:4,liveRound:null,nextRound:5,phase:"between-rounds",dateRange:null,timeControl:"90 min + 30 sec",sourceUpdatedAt:null,fetchedAt:"2026-09-27T12:00:00Z",warnings:[],players:names.map((name,index)=>({startNumber:index+1,name,fideId:String(100000+index),federation:"ENG",title:null,rating:2050+index*25,rank:index+1,points:index===0?3:2.5,active:true})),pairings:[{round:1,board:1,whiteStartNumber:1,blackStartNumber:3,whitePoints:0,blackPoints:0,result:"1-0",decided:true}]};
const server=await createServer({server:{host:"127.0.0.1",port:1437,strictPort:true},plugins:[{name:"synthetic-tournament-api",configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(!req.url.startsWith("/api/") && !req.url.startsWith("/web-library/"))return next();
  const json=(value,status=200)=>{res.statusCode=status;res.setHeader("Content-Type","application/json");res.end(JSON.stringify(value));};
  try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
    if(req.url==="/api/tournaments"){
      const p=body.params ?? {};let result;
      switch(body.method){
        case "settingsGet":result=settings.get(p.key) ?? null;break;
        case "settingsSet":settings.set(p.key,p.value);result=null;break;
        case "collectionCreate":{let entry=[...collections.values()].find(c=>c.requestKey===p.requestKey);if(!entry){entry={id:nextId++,name:p.name,folder:null,game_count:0,metadata:{},requestKey:p.requestKey};collections.set(entry.id,entry);}result=entry.id;break;}
        case "collectionGet":result=collections.get(p.id);break;
        case "collectionList":result=[...collections.values()];break;
        case "collectionUpdate":{const entry=collections.get(p.id);Object.assign(entry,{game_count:p.gameCount,metadata:p.metadata});result=null;break;}
        case "collectionSetFolder":collections.get(p.id).folder=p.folder;result=null;break;
        case "collectionSetDescription":collections.get(p.id).description=p.description;result=null;break;
        case "collectionForget":collections.delete(p.id);result=null;break;
        case "fetchTournamentSnapshot":result=fixture;break;
        case "discoverTournaments":result={events:[{tournamentId:fixture.tournamentId,sourceUrl:fixture.sourceUrl,title:fixture.title,section:"Open",federation:"ENG",startDate:"2026-10-03",endDate:"2026-10-04",lastUpdate:null,location:"Synthetic venue",timeControl:"Classical",playerCount:fixture.players.length}],sourceCount:1,sourceLimitReached:false,fetchedAt:new Date().toISOString()};break;
        case "searchTournaments":result=[{tournamentId:fixture.tournamentId,sourceUrl:fixture.sourceUrl,title:fixture.title,section:"Open",federation:"ENG",startDate:"2026-10-03",endDate:"2026-10-04",lastUpdate:null}];break;
        case "tournamentEventMetadata":result={organizerUrl:null,imageUrl:null};break;
        case "dataPackStatus":result={catalog:[],jobs:[],selectedIds:[],defaultParent:"Synthetic PC download folder"};break;
        case "otbLibraryStatus":result={downloaded:false,managed:false,months:[],bytes:0,enabled:false,partiallyEnabled:false,keepYears:null,parent:null,maintenanceNeeded:false,pendingIds:[]};break;
        default:throw new Error("This synthetic exercise does not download or remove archive data.");
      }
      return json({result});
    }
    const match=req.url.match(/^\/api\/otb-import\/jobs\/([^/?]+)(\/artifact)?$/);
    if(match){const id=decodeURIComponent(match[1]);let job=jobs.get(id);
      if(req.method==="PUT"&&!job){
        const pgn=`[Event "Synthetic tournament QA"]\n[Date "2026.09.01"]\n[White "${body.playerName}"]\n[Black "Fixture Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`;
        const prepDatabase=buildWebOtbPrepDatabase({name:`${body.playerName}.pgn`,pgn,importedAt:Date.now()});
        job={id,status:"completed",request:body,progress:null,report:{playerName:body.playerName,fideId:body.fideId,cancelled:false,gamesFound:1,duplicatesRemoved:0,coverageComplete:true,coverageGaps:[]},gameCount:1,artifactAvailable:true,artifactBytes:pgn.length,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:new Date().toISOString(),error:null,games:[],prepDatabase};jobs.set(id,job);
      }
      if(!job)return json({error:"Unknown synthetic job"},404);
      return json(match[2]?{jobId:id,games:[],prepDatabase:job.prepDatabase}:job);
    }
    if(req.url.startsWith("/web-library/"))return json({version:1,databases:[],files:[]});
    return json({error:"Not available in synthetic UI exercise"},404);
  }catch(error){return json({error:String(error.message||error)},400);}
});}}]});
await server.listen();console.log("Synthetic phone UI: http://127.0.0.1:1437 (no owner data or downloads)");
