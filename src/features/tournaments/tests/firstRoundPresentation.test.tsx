import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { usePairingForecast } from "../usePairingForecast";
import { TournamentTrackerView } from "../TournamentTrackerView";
import { trackerFixture } from "./trackerFixture";
import type { TournamentSnapshot } from "@/features/tournaments/platform";

const callbacks={onOpponent:async()=>{},onOpenDatabase:()=>{},onToggleUpdate:async()=>{},onCheck:async()=>{},onStop:async()=>{},onRemove:async()=>{},projectedSideFor:()=>"white" as const};
function fixture() {
  const {record}=trackerFixture();
  record.snapshot={...record.snapshot,phase:"registration",publishedRound:0,completedRound:0,nextRound:1,liveRound:null,pairings:[],roundStandings:[]};
  return record;
}
function Probe({snapshot,selected}:{snapshot:TournamentSnapshot;selected:number|null}) {
  const {forecast,isCalculating}=usePairingForecast(snapshot,selected);
  return <output>{JSON.stringify({kind:forecast?.kind,round:forecast?.round,candidates:forecast?.candidates.length,probability:forecast?.candidates[0]?.probability,updating:isCalculating})}</output>;
}
describe("round one at the presentation boundary",()=>{
  test("registration retains conditional candidates without numerical confidence while solving is requested",()=>{
    const markup=renderToStaticMarkup(<Probe snapshot={fixture().snapshot} selected={1}/>);
    expect(markup).toContain('&quot;kind&quot;:&quot;estimated&quot;');
    expect(markup).toContain('&quot;round&quot;:1');
    expect(markup).toContain('&quot;candidates&quot;:6');
    expect(markup).toContain('&quot;probability&quot;:null');
    expect(markup).toContain('&quot;updating&quot;:true');
  });
  test("does not request a forecast until the user selects an entry",()=>{
    expect(renderToStaticMarkup(<Probe snapshot={fixture().snapshot} selected={null}/>)).toBe('<output>{&quot;updating&quot;:false}</output>');
  });
  test("opens selected pre-play trackers on predictions and shows an actual bye result",()=>{
    const record=fixture();
    const markup=renderToStaticMarkup(<TournamentTrackerView record={record} forecast={{kind:"confirmed",round:1,confidence:"confirmed",candidates:[],otherProbability:0,summary:"Round 1 bye published",caveat:null}} calculating={false} running={false} prepBusy={null} removeBusy={false} settingBusy={false} syncEvent={null} error={null} {...callbacks}/>);
    expect(markup).toContain('id="tournament-next-tab" type="button" role="tab" aria-label="Next round" aria-selected="true"');
    expect(markup).toContain('Round 1 bye published');
    expect(markup).not.toContain('Pairings not published');
  });
});
