import { MantineProvider } from "@mantine/core";
import { TournamentEmbedded } from "../ui";
import { renderToStaticMarkup as renderRaw } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { TournamentEventPreview } from "../TournamentEventPreview";
import { matchTournamentImportOpponent, mergeTournamentRoster } from "../tournamentRoster";
import { rankTournamentPlayers } from "../tournamentFinder";
import { trackerFixture } from "./trackerFixture";
import { PlayerGameImportModal } from "@/features/tournaments/TournamentPlayerImport";

vi.mock("@/features/tournaments/platform", () => ({ isDesktop: () => true, isNativeDesktop: () => false, desktopApi: {} }));

const renderToStaticMarkup=(node:React.ReactNode)=>renderRaw(<MantineProvider><TournamentEmbedded.Provider value={true}>{node}</TournamentEmbedded.Provider></MantineProvider>);

describe("visible tournament entries and exact imports", () => {
  test("shows entrants, ratings and self selection without a collapsed disclosure", () => {
    const { record } = trackerFixture();
    const markup = renderToStaticMarkup(<TournamentEventPreview snapshot={record.snapshot} selectedPlayer={null} onSelectPlayer={()=>{}} fromYear={2023} onYear={()=>{}} onSection={()=>{}} onBack={()=>{}} onFollow={()=>{}} busy={false} saving={false} error={null}/>);
    expect(markup).toContain("Who are you?");
    expect(markup).toContain("Registered players (7)");
    expect(markup).toContain("2050 rating");
    expect(markup).toContain("FIDE 100000");
    expect(markup).toContain("This is me");
    expect(markup).not.toContain("Choose my entry (optional)");
    expect(markup.indexOf('aria-label="Tournament players"')).toBeLessThan(markup.indexOf("<details>"));
  });

  test("does not silently cap either the roster or name search at 80 players", () => {
    const player=trackerFixture().record.snapshot.players[0];
    const players=Array.from({length:121},(_,index)=>({...player,startNumber:index+1,name:`Player ${String(index).padStart(3,"0")}`}));
    expect(rankTournamentPlayers("",players)).toHaveLength(121);
    expect(rankTournamentPlayers("Player",players)).toHaveLength(121);
  });

  test.each(["1002", null])("tournament import has fixed identity and no suggestion picker: %s", fideId => {
    const markup=renderToStaticMarkup(<PlayerGameImportModal initialOtb={{playerName:"Sam Rivera",fideId,fromYear:2023,databaseName:"Sam Rivera",lockIdentity:true}} onClose={()=>{}} onDone={()=>{}}/>);
    expect(markup).toContain('value="Sam Rivera"');
    expect(markup).toContain('readOnly=""');
    expect(markup).not.toContain('role="combobox"');
    if(fideId) expect(markup).toContain('value="1002"');
    else {
      expect(markup).toContain("No FIDE ID/profile is listed");
      expect(markup).toMatch(/disabled=""/);
    }
  });

  test("same name with a different imported FIDE ID is refused", () => {
    const {record}=trackerFixture(), expected=record.opponents["3"];
    expect(()=>matchTournamentImportOpponent(record,expected,{playerName:expected.name,fideId:"99999"})).toThrow("does not match");
    expect(()=>matchTournamentImportOpponent(record,{...expected,fideId:null},{playerName:expected.name,fideId:null})).toThrow("does not match");
  });

  test("follows a unique FIDE identity through start-number and name updates", () => {
    const {record}=trackerFixture(), expected=record.opponents["3"];
    const snapshot={...record.snapshot,players:record.snapshot.players.map(player=>({...player,startNumber:player.startNumber+50,name:player.name+" Updated"}))};
    const current=mergeTournamentRoster(record,snapshot).record;
    expect(matchTournamentImportOpponent(current,expected,{playerName:expected.name,fideId:expected.fideId})).toMatchObject({startNumber:53,fideId:expected.fideId,name:expected.name+" Updated"});
  });

  test("refuses withdrawn, ambiguous, and reassigned opponents", () => {
    const {record}=trackerFixture(), expected=record.opponents["3"];
    const imported={playerName:expected.name,fideId:expected.fideId};
    const player=record.snapshot.players[2];
    const withdrawn={...record,snapshot:{...record.snapshot,players:record.snapshot.players.filter(p=>p!==player)}};
    expect(()=>matchTournamentImportOpponent(withdrawn,expected,imported)).toThrow("uniquely identified");
    const duplicate={...record,snapshot:{...record.snapshot,players:[...record.snapshot.players,{...player,startNumber:99}]}};
    expect(()=>matchTournamentImportOpponent(duplicate,expected,imported)).toThrow("uniquely identified");
    const reassigned={...record,opponents:{...record.opponents,3:{...expected,fideId:"99999"}}};
    expect(()=>matchTournamentImportOpponent(reassigned,expected,imported)).toThrow("uniquely identified");
  });

  test("uses a roster FIDE ID missing from an older opponent record", () => {
    const {record}=trackerFixture(), expected=record.opponents["3"];
    const stale={...record,opponents:{...record.opponents,3:{...expected,fideId:null}}};
    expect(matchTournamentImportOpponent(stale,expected,{playerName:expected.name,fideId:expected.fideId}).fideId).toBe(expected.fideId);
  });
});
