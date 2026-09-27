import { afterEach, expect, test, vi } from 'vitest';
import type { TournamentSnapshot } from '@/features/tournaments/platform';
import { calculateSampledSwissForecast } from '../sampledSwissForecast';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});

test('actual worker returns the same forecast as the selected-player API for every seat',async()=>{
  let receive!: (event:{data:unknown})=>void;
  const postMessage=vi.fn();
  vi.stubGlobal('self',{addEventListener:(_type:string,listener:typeof receive)=>{receive=listener;},postMessage});
  await import('../exactSwissForecast.worker');
  const base={tournamentId:'field-protocol',title:'Swiss',format:'swiss',formatLabel:'Swiss',totalRounds:5,
    completedRound:1,publishedRound:1,nextRound:2,liveRound:null,
    players:Array.from({length:6},(_,i)=>({startNumber:i+1,name:`Player ${i+1}`,rating:2000-100*i,points:i<3?1:0,rank:null,active:true})),
    pairings:[[1,4],[2,5],[3,6]].map(([whiteStartNumber,blackStartNumber],i)=>({round:1,board:i+1,whiteStartNumber,blackStartNumber,result:'1-0',decided:true})),
  } as TournamentSnapshot;
  for(const live of [false,true]){
    const snapshot=structuredClone(base);
    if(live){snapshot.liveRound=1;snapshot.completedRound=0;snapshot.pairings[2].result=null;snapshot.pairings[2].decided=false;snapshot.players.forEach(p=>p.points=0);}
    const reference=structuredClone(snapshot);
    const expected=Object.fromEntries(reference.players.map(p=>[p.startNumber,calculateSampledSwissForecast(reference,2,p.startNumber)]));
    receive({data:{id:live?2:1,snapshot,targetRound:2,system:'dutch'}});
    expect(postMessage.mock.lastCall?.[0]).toEqual({id:live?2:1,forecasts:expected});
    expect(snapshot).toEqual(reference);
  }
});

test('actual field worker distinguishes a city title from a declared acceleration method', async () => {
  let receive!: (event: { data: unknown }) => void;
  const postMessage = vi.fn();
  vi.stubGlobal('self', { addEventListener: (_type: string, listener: typeof receive) => { receive = listener; }, postMessage });
  await import('../exactSwissForecast.worker');
  for (const [title, formatLabel, opponent, acceleration] of [
    ['Baku Open', 'Swiss-System', 11, null],
    ['Baku Acceleration Open', 'Swiss-System', 6, 'baku'],
    ['City Open', 'Swiss-System (Baku)', 6, 'baku'],
  ] as const) {
    const snapshot: TournamentSnapshot = { tournamentId: title, title, format: 'swiss', formatLabel, totalRounds: 9,
      sourceUrl: 'https://chess-results.com/tnr42.aspx', section: null, phase: 'registration', dateRange: null,
      timeControl: null, sourceUpdatedAt: null, fetchedAt: 'synthetic', warnings: [],
      completedRound: 0, publishedRound: 0, nextRound: 1, liveRound: null, pairings: [],
      players: Array.from({ length: 20 }, (_, index) => ({ startNumber: index + 1, name: `Player ${index + 1}`,
        rating: 2200 - index * 20, points: 0, rank: null, active: true, fideId: null, federation: null, title: null })),
    };
    receive({ data: { id: 42, snapshot, targetRound: 1, system: 'dutch' } });
    const response = postMessage.mock.lastCall?.[0];
    expect(response.id).toBe(42);
    expect(Object.keys(response.forecasts)).toHaveLength(20);
    expect(response.forecasts[1]).toMatchObject({ opponentStartNumber: opponent, acceleration });
    expect(response.forecasts[opponent]).toMatchObject({ opponentStartNumber: 1, acceleration });
  }
});
