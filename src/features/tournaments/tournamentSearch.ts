import type { TournamentSearchResult } from "@/features/tournaments/platform";
import countries from "./tournamentCountries.json";

const CONNECTORS = new Set(["the", "a", "an", "in", "at", "of", "and", "for", "near", "me", "find", "please"]);
const DESCRIPTORS = new Set(["chess", "tournament", "tournaments", "event", "events"]);
const UK_FEDERATIONS = new Set(["ENG", "SCO", "WLS", "NIR", "GBR"]);
const ALIASES:Record<string,string>={champs:"championship",championships:"championship",champ:"championship",juniors:"junior",qualifiers:"qualifier",intl:"international",int:"international",welsh:"wales",scottish:"scotland",english:"england",irish:"ireland"};

function words(value: string): string[] {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[’']/g, "").replace(/\b(?:under|u)[\s-]*(\d+)\b/g,"u$1")
    .match(/[\p{L}\p{N}]+/gu)?.map(word=>ALIASES[word]??word) ?? [];
}
export function tournamentQueryWords(query:string):string[]{
  const tokens=[...new Set(words(query).filter(word=>!CONNECTORS.has(word)))];
  const specific=tokens.filter(word=>!DESCRIPTORS.has(word));
  return specific.length?specific:tokens;
}

// Adjacent transpositions count as one typo. Short words and numbers must
// match exactly; otherwise a year or rating section could become another one.
function wordCost(query: string, candidate: string): number {
  if (query === candidate) return 0;
  if (/\d/.test(query) || /\d/.test(candidate)) return Infinity;
  if (query.length >= 3 && candidate.startsWith(query)) return 0.12;
  const limit = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0;
  if (!limit || query.length - candidate.length > limit) return Infinity;
  const fullLength=candidate.length;
  // Only the beginning can match an unfinished word; do not compare its entire tail.
  candidate=candidate.slice(0,query.length+limit);
  let previous = Array.from({ length: candidate.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= query.length; i++) {
    const row = [i];
    for (let j = 1; j <= candidate.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (query[i - 1] === candidate[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && query[i - 1] === candidate[j - 2] && query[i - 2] === candidate[j - 1]) {
        row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
      }
    }
    beforePrevious = previous;
    previous = row;
  }
  const distance = previous[candidate.length];
  // An unfinished word may itself contain a typo ("bristl quali").
  const prefixDistance=query.length>=4&&candidate.length>query.length
    ? Math.min(...previous.slice(query.length,query.length+2)) : Infinity;
  return Math.min(fullLength===candidate.length&&distance<=limit?0.3*distance:Infinity,prefixDistance<=1?0.3*prefixDistance+0.18:Infinity);
}

function cachedWordCost(){
  const costs=new Map<string,Map<string,number>>();
  return (query:string,candidate:string)=>{
    let matches=costs.get(query);if(!matches){matches=new Map();costs.set(query,matches);}
    let cost=matches.get(candidate);
    if(cost===undefined){cost=wordCost(query,candidate);matches.set(candidate,cost);}
    return cost;
  };
}

type Vocabulary=Array<{word:string;penalty:number}>;
const indexCache=new WeakMap<TournamentSearchResult,Vocabulary>();
function eventWords(event:TournamentSearchResult):Vocabulary{
  const cached=indexCache.get(event);if(cached)return cached;
  const country=countries.find(item=>item.code===event.federation);
  const fields:Array<[string|null|undefined,number]>=[
    [event.title,0],[event.section,0.02],[event.location,0.04],[event.organizer,0.08],[event.timeControl,0.08],
    [[event.federation,country?.name,...(country?.regions.filter(region=>region!=="UK & Ireland")??[]),
      UK_FEDERATIONS.has(event.federation??"")?"UK United Kingdom Britain British":""].filter(Boolean).join(" "),0.1],
    // Published dates can supply a year even when the organizer omits it from the title.
    [[event.startDate?.match(/^\d{4}/)?.[0],event.endDate?.match(/^\d{4}/)?.[0]].filter(Boolean).join(" "),0.06],
  ];
  const vocabulary:Vocabulary=[];
  for(const [value,penalty] of fields){
    const tokens=words(value??"");
    for(let i=0;i<tokens.length;i++){
      vocabulary.push({word:tokens[i],penalty});
      if(tokens[i+1]&&!/\d/.test(tokens[i]+tokens[i+1]))vocabulary.push({word:tokens[i]+tokens[i+1],penalty:penalty+0.08});
    }
  }
  indexCache.set(event,vocabulary);return vocabulary;
}

/** Source retrieval seeds are fragments, never fuzzy decisions or invented events. */
export function tournamentSearchSeeds(query:string,events:TournamentSearchResult[]):string[]{
  const generic=new Set(["open","rapid","blitz","classical","congress","championship","international","junior"]);
  const tokens=tournamentQueryWords(query).filter(token=>token.length>=3&&!/\d/.test(token))
    .sort((a,b)=>Number(generic.has(a))-Number(generic.has(b))||b.length-a.length);
  if(!tokens.length)return [];
  const primary=tokens[0];
  // Use the visible directory vocabulary to recover a likely spelling when available.
  let correction=primary,best=0.61;
  const match=cachedWordCost();
  for(const event of events)for(const {word,penalty} of eventWords(event)){
    const cost=match(primary,word)+penalty;
    if(cost>0&&cost<best&&word.length>=primary.length-2){best=cost;correction=word;}
    if(cost===0){correction=primary;best=0;}
  }
  const fragments=primary.length>=6?[primary.slice(0,3),primary.slice(-3)]:[];
  return [...new Set([correction,...fragments,...tokens])].slice(0,4);
}

/** All meaningful query words must match, in any order and across fields. */
export function searchTournamentEvents(query: string, events: TournamentSearchResult[]): TournamentSearchResult[] {
  const tokens = tournamentQueryWords(query);
  if (!tokens.length) return [...events];
  const match=cachedWordCost();
  return events.map((event, index) => {
    const vocabulary=eventWords(event);
    const costs=Array(tokens.length+1).fill(Infinity);costs[0]=0;
    for(let i=0;i<tokens.length;i++){
      if(!Number.isFinite(costs[i]))continue;
      for(const {word,penalty} of vocabulary){
        costs[i+1]=Math.min(costs[i+1],costs[i]+match(tokens[i],word)+penalty);
        if(tokens[i+1]&&!/\d/.test(tokens[i]+tokens[i+1]))
          costs[i+2]=Math.min(costs[i+2],costs[i]+match(tokens[i]+tokens[i+1],word)+penalty+0.08);
      }
    }
    let score=costs[tokens.length];
    // Prefer an exact title phrase when all other words match equally well.
    if (words(event.title).join(" ").includes(tokens.join(" "))) score -= 0.01;
    return { event, index, score };
  }).filter(result => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(result => result.event);
}
