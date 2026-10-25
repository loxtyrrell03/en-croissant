import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
mkdirSync(dir, { recursive: true });
const c = { bg: "#111315", panel: "#1b1e22", input: "#25272d", edge: "#34383f", text: "#f1f3f5", muted: "#a7acb4", blue: "#74c0fc", fill: "#1971c2", green: "#8ce99a", red: "#ffa8a8" };
const esc = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const text = (x,y,s,size=14,color=c.text,weight=400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(s)}</text>`;
const rect = (x,y,w,h,fill=c.panel,r=7,stroke=c.edge) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const rule = y => `<path d="M16 ${y}H374" stroke="${c.edge}"/>`;
const button = (x,y,w,label,primary=false) => rect(x,y,w,44,primary?c.fill:c.input)+text(x+12,y+28,label,14,primary?"white":c.text,600);
const input = (y,label,value) => text(16,y,label,12,c.muted)+rect(16,y+10,358,44,c.input)+text(28,y+38,value,14);
const section = (y,title,aside="") => text(16,y,title,19,c.text,700)+text(275,y,aside,12,c.blue);
const row = (y,title,sub,action="Open") => rule(y-23)+text(16,y,title,15,c.text,600)+text(16,y+23,sub,12,c.muted)+text(294,y+10,action,13,c.blue,600);
const tabs = (y,labels,active=0) => labels.map((s,i) => {const w=358/labels.length;return rect(16+i*w,y,w,44,i===active?c.input:c.bg,5)+text(24+i*w,y+28,s,labels.length>4?11:13,i===active?c.blue:c.muted,i===active?700:400);}).join("");
const board = y => Array.from({length:64},(_,i)=>`<rect x="${19+i%8*44}" y="${y+Math.floor(i/8)*44}" width="44" height="44" fill="${(Math.floor(i/8)+i%8)%2?"#769656":"#eeeed2"}"/>`).join("")+text(62,y+73,"♜   ♞   ♝   ♛   ♚",30,"#1a2025")+text(62,y+310,"♙   ♙   ♙   ♙   ♙",30,"#f8f8f2")+text(112,y+178,"♟",36,"#1a2025")+text(200,y+222,"♘",36,"#f8f8f2");
const titles = ["Board","Tournaments","Import","Review","Files","Stats"];
const variants = [
  {id:"A",name:"Compact tabs",description:"Six familiar pages stay visible. Tools form short rows; settings fold away."},
  {id:"B",name:"Bottom navigation",description:"Four frequent pages sit by your thumb. Import and Stats open from More."},
  {id:"C",name:"Page switcher",description:"One page title opens the full page list. More room for each task."},
];
function shell(v,page){
  let s=rect(0,0,390,820,c.bg,16)+text(24,27,"9:41",13,c.text,600)+text(307,27,"▮▮  ▰",13,c.text);
  if(v.id==="A") s+=tabs(42,["Board","Events","Import","Review","Files","Stats"],titles.indexOf(page))+rule(94);
  else s+=text(16,73,page+(v.id==="C"?"  ▾":""),23,c.text,700)+text(312,71,v.id==="B"?"Settings":"Tools",13,c.blue)+rule(92);
  s+=text(16,119,"PC services",12,c.muted)+text(248,119,"Ready",12,c.green)+rect(307,101,64,30,c.fill,15)+`<circle cx="355" cy="116" r="11" fill="white"/>`;
  if(v.id==="B") s+=rect(0,748,390,72,c.panel,0)+tabs(751,["Board","Events","Review","Files","More"],Math.max(0,["Board","Tournaments","Review","Files"].indexOf(page)));
  s+=text(16,808,"EXAMPLE DATA · editable design",10,c.muted);
  return s;
}
function page(v,name){
  let s=shell(v,name);
  const y=161;
  if(name==="Tournaments"){
    s+=text(16,y,"← Following",13,c.blue)+button(242,y-27,132,"Stop following");
    s+=section(207,"Cardiff Autumn Open")+text(16,233,"Complete · 7 rounds",12,c.muted);
    s+=text(16,264,"Your entry",12,c.muted)+rect(16,275,358,44,c.input)+text(28,303,"Jordan Vale                    Change",14);
    s+=button(16,331,110,"Refresh")+text(147,359,"Chess-Results ↗",13,c.blue)+text(332,359,"?",15,c.blue);
    s+=tabs(390,["Next round","Players","Standings"])+tabs(437,["Results","Tracking"],-1);
    s+=text(16,518,"Your points",12,c.muted)+text(16,550,"4 / 7",23,c.text,700)+text(181,518,"Your order",12,c.muted)+text(181,550,"2",23,c.text,700);
    s+=section(593,"Round 7 · Pairing")+text(16,621,"Sam Rivera · You played White",14)+button(16,642,358,"Open Prep");
    s+=text(16,724,"Past predictions →",14,c.blue);
  }else if(name==="Board"){
    s+=section(y,"Current game","Flip board")+board(181)+tabs(550,["Moves","Database","Prep"])+tabs(597,["Analysis","Coach"],-1);
    s+=text(16,680,"Stockfish · Off",14,c.muted)+button(242,653,132,"Start analysis",true)+text(16,725,"1. e4 e5  2. Nf3 Nc6",16);
  }else if(name==="Import"){
    s+=section(y,"Import games")+tabs(183,["Online","PGN","OTB player"]);
    s+=input(261,"Source","Chess.com                           ▾")+input(344,"Username","Enter a public username");
    s+=input(426,"Games","Last 30 days                       ▾")+button(16,493,358,"Import games",true);
    s+=text(16,573,"More options  ▾",14,c.blue)+rule(600)+section(637,"Recent imports")+row(678,"Jordan’s games","24 saved games","Open");
  }else if(name==="Review"){
    s+=section(y,"Daily review","Settings")+text(16,194,"5 mistakes ready",14,c.muted)+board(218);
    s+=button(16,587,358,"Start review",true)+row(677,"Recent reviews","3 reviewed today","View");
  }else if(name==="Files"){
    s+=section(y,"Files","Import PGN")+rect(16,184,358,44,c.input)+text(28,212,"Search files and databases",14,c.muted);
    s+=tabs(245,["On PC","On this phone"])+row(330,"Opponent games","Folder · 3 databases","Open")+row(405,"Opening preparation","Folder · 4 PGNs","Open")+row(480,"Sam Rivera","256 games · Updated today","Prep");
    s+=text(16,558,"Show archived  ▾",14,c.blue)+text(16,610,"Select a file to view its games.",13,c.muted);
  }else{
    s+=section(y,"Stats","Refresh")+rect(16,185,358,44,c.input)+text(28,213,"Chess.com · JordanVale       Edit",14)+tabs(247,["Overview","Strength","Report"]);
    s+=text(16,328,"Last 30 days  ▾",14,c.blue)+text(16,380,"Games",12,c.muted)+text(16,420,"42",30,c.text,700)+text(195,380,"Rapid performance",12,c.muted)+text(195,420,"1842",30,c.text,700);
    s+=rule(453)+section(490,"Results")+rect(16,514,358,35,c.input,4)+rect(16,514,179,35,"#42694d",4)+text(28,538,"Wins 50%",13)+text(205,538,"Draws 10%",11)+text(300,538,"Losses 40%",10);
    s+=section(606,"Recent games")+row(652,"JordanVale – SamRivera","Rapid · Win · Today","Open");
  }
  return s;
}
const detailNames=["Discovery & setup","Player predictions","Database & Prep","Analysis & Coach","Game / source details","Stats & review settings"];
function detail(v,name,index){
  let s=shell(v,index<2?"Tournaments":index<4?"Board":index===4?"Files":"Stats");
  s+=section(165,name);
  if(index===0) s+=tabs(187,["Discover","Following"])+input(267,"Tournament","Name or Chess-Results link")+input(351,"Region / dates","Wales · Upcoming                  Edit")+button(16,421,358,"Find tournaments",true)+row(533,"Cardiff Autumn Open","Open · 7 rounds · 23 players","View")+input(594,"Your entry","Select your name                    ▾")+button(16,661,358,"Follow tournament",true);
  if(index===1) s+=text(16,204,"← Players",14,c.blue)+section(248,"Sam Rivera")+tabs(273,["Next round","Past predictions"],1)+input(358,"Round / saved estimate","Round 5 · Before pairings          ▾")+text(16,454,"Predicted opponent",12,c.muted)+text(16,483,"Alex Morgan · ~23%",18,c.text,600)+text(16,530,"Published opponent",12,c.muted)+text(16,559,"Alex Morgan · White",18,c.green,600)+text(16,604,"Full shortlist  ▾",14,c.blue)+button(16,659,358,"Open Prep");
  if(index===2) s+=tabs(187,["Database","Prep"],1)+input(266,"Opponent","Sam Rivera · 256 games             ▾")+tabs(340,["I’m White","I’m Black"])+input(426,"Starting position","Current board                     Change")+button(16,493,358,"Build preparation",true)+text(16,570,"Filters and line settings  ▾",14,c.blue)+row(659,"1. e4 e5 2. Nf3","12 saved lines · White","Open");
  if(index===3) s+=tabs(187,["Analysis","Coach"])+input(267,"Engine","Stockfish                           ▾")+button(16,334,358,"Start analysis",true)+text(16,417,"Evaluation — · Depth —",14,c.muted)+text(16,453,"Lines and engine settings  ▾",14,c.blue)+rule(491)+section(531,"Coach")+text(16,565,"Choose an idea for this position.",14,c.muted)+button(16,589,358,"Find plans")+button(16,647,358,"Review pawn structure");
  if(index===4) s+=text(16,204,"← Opponent games",14,c.blue)+section(248,"Sam Rivera")+text(16,283,"256 saved games · OTB",14,c.muted)+tabs(310,["Games","Details"])+row(403,"Rivera – Morgan","1–0 · 2026.10.18 · Classical","Open")+row(481,"Vale – Rivera","½–½ · 2026.10.17 · Classical","Open")+text(16,568,"Source and filters  ▾",14,c.blue)+button(16,611,358,"Open Prep",true)+text(16,697,"Archive database…",14,c.muted);
  if(index===5) s+=input(217,"Online account","Chess.com · JordanVale           Change")+input(301,"Period","Custom dates                        ▾")+input(385,"Date range","1 Oct 2026 – 25 Oct 2026")+button(16,452,358,"Apply dates",true)+rule(526)+section(564,"Review settings")+text(16,603,"Automatic preparation           On",14)+text(16,642,"Batch size                          5 cards",14)+text(16,701,"Pause automatic preparation",14,c.blue);
  return s;
}
const stateNames=["Loading","Empty","Error & retry","Progress & cancellation","Stop following confirmation","Settings & page list","Adjacent help","Saving / retry"];
function state(v,name,index){
  let s=shell(v,index<5?"Tournaments":index===5?"Board":index===6?"Stats":"Files")+section(166,name);
  if(index===0)s+=text(16,236,"Checking published pairings…",16,c.muted)+rect(16,272,358,22,c.input)+rect(16,312,232,22,c.input)+button(16,377,140,"Cancel check");
  if(index===1)s+=section(258,"No tournaments followed")+text(16,292,"Find an event to see players and pairings.",13,c.muted)+button(16,326,358,"Discover tournaments",true);
  if(index===2)s+=text(16,238,"Could not refresh this tournament.",16,c.red)+text(16,273,"The saved tracker is still available.",13,c.muted)+button(16,310,160,"Retry check",true);
  if(index===3)s+=section(253,"Importing opponent games")+text(16,287,"Sam Rivera · 120 of 256 games",14,c.muted)+rect(16,310,358,8,c.edge,4)+rect(16,310,168,8,c.fill,4)+button(16,346,158,"Cancel import")+text(16,427,"After cancellation: Import stopped.",13,c.muted)+button(16,455,160,"Resume import");
  if(index===4)s+=rect(16,239,358,280,c.panel,12)+text(34,280,"Stop following?",21,c.text,700)+text(34,320,"Entry and pairing checks will stop.",14)+text(34,352,"Your imported games will be kept.",14,c.muted)+button(34,430,123,"Cancel")+button(168,430,184,"Stop following",true);
  if(index===5)s+=text(16,227,"PC services                    Ready   On",14)+text(16,268,"? Off stops analysis and reviews.",13,c.muted)+text(16,318,v.id==="C"?"Switch page":v.id==="B"?"More":"Workspace",18,c.text,600)+titles.map((t,i)=>text(24,361+i*48,t,16,i===0?c.blue:c.text)).join("");
  if(index===6)s+=text(16,245,"Rapid performance  ?",17,c.text,600)+rect(16,265,358,100,c.panel)+text(30,298,"An estimate from your results in this period.",13)+text(30,325,"It is separate from your account rating.",13,c.muted)+text(310,350,"Close",12,c.blue)+text(16,417,"Opens on hover, focus or tap.",13,c.muted);
  if(index===7)s+=text(16,235,"Changes haven’t been saved.",17,c.red)+text(16,274,"Keep this page open and retry.",14)+button(16,303,160,"Retry save",true)+rule(404)+section(447,"Folder / game stays open")+text(16,481,"No automatic reload or lost edits.",13,c.muted);
  return s;
}
function svg(w,h,title,body){return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="100%" height="100%" fill="#0b0d0f"/><g font-family="Arial, sans-serif">${body}</g></svg>`;}
function sheet(v,names,render,type){
  const cols=type==="states"?4:3;
  let body=text(26,38,`${v.id} · ${v.name} — ${type}`,27,c.text,700)+text(26,67,v.description,15,c.muted);
  names.forEach((n,i)=>{const x=26+i%cols*416,y=116+Math.floor(i/cols)*875;body+=text(x,y-14,n,16,c.text,600)+`<g transform="translate(${x} ${y})">${render(v,n,i)}</g>`;});
  writeFileSync(join(dir,`${v.id}-${type}.svg`),svg(cols*416+26,116+Math.ceil(names.length/cols)*875,`${v.name} ${type}`,body));
}
for(const v of variants){sheet(v,titles,page,"pages");sheet(v,detailNames,detail,"details");sheet(v,stateNames,state,"states");}
let compare=text(26,38,"En Croissant · Phone usability options",28,c.text,700)+text(26,68,"Existing dark theme and blue controls. All names, scores and counts below are illustrative.",15,c.muted);
variants.forEach((v,i)=>{const x=26+i*416;compare+=text(x,114,`${v.id} · ${v.name}`,22,c.text,700)+`<g transform="translate(${x} 137)">${page(v,"Tournaments")}</g>`;});
writeFileSync(join(dir,"comparison.svg"),svg(1274,985,"Three editable phone design options",compare));
writeFileSync(join(dir,"index.html"),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>En Croissant phone designs</title><style>body{background:#111315;color:#f1f3f5;font:16px system-ui;margin:24px;max-width:1400px}a{color:#74c0fc}img{max-width:100%;height:auto}article{padding:16px 0;border-bottom:1px solid #34383f}p{max-width:75ch;line-height:1.5}</style><h1>Phone usability options</h1><p>Editable SVGs. Example names, scores and counts. The Stop following visibility fix ships separately; the broader layout awaits your chosen direction.</p><img src="comparison.svg" alt="A compact tabs, B bottom navigation, C page switcher">${variants.map(v=>`<article><h2>${v.id} · ${v.name}</h2><p>${v.description}</p><p><a href="${v.id}-pages.svg">All six pages</a> · <a href="${v.id}-details.svg">Subpages and setup</a> · <a href="${v.id}-states.svg">Loading, errors, settings and confirmations</a></p></article>`).join("")}<p><a href="audit.md">Surface and state audit</a></p></html>`);
console.log("Generated 10 editable SVGs and the review index.");
