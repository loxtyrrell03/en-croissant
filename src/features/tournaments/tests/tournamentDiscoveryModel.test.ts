import {describe,expect,test} from "vitest";
import {cacheDiscoveryResponse,discoveryCache,countries,defaultDiscoveryFilters,discoveryRequest,readableDate} from "../tournamentDiscoveryModel";
describe("tournament discovery filters",()=>{
  test("bounds both directory and query response entries while filters change",()=>{
    discoveryCache.clear();
    for(let i=0;i<50;i++)cacheDiscoveryResponse(String(i),{events:[],sourceCount:0,sourceLimitReached:false,fetchedAt:"2026-10-24"});
    expect(discoveryCache.size).toBe(20);expect(discoveryCache.has("0")).toBe(false);expect(discoveryCache.has("49")).toBe(true);
    discoveryCache.clear();
  });
  test("browses without a search term and narrows UK federations at the source boundary",()=>{
    const request=discoveryRequest({...defaultDiscoveryFilters(),region:"UK & Ireland",country:"WLS"},new Date(2026,8,11));
    expect(request).toMatchObject({query:"",from:"2026-09-11",to:"2026-12-11",country:"WLS",period:"upcoming"});
    expect(request.federations).toEqual(expect.arrayContaining(["ENG","SCO","WLS","IRL"]));expect(request.federations).not.toContain("USA");
  });
  test("keeps custom dates and missing dates explicit",()=>{
    expect(discoveryRequest({...defaultDiscoveryFilters(),dates:"custom",from:"2027-01-01",to:"2027-02-01"},new Date(2026,8,11))).toMatchObject({from:"2027-01-01",to:"2027-02-01"});
    expect(readableDate(null)).toBe("Date to be confirmed");expect(countries.find(c=>c.code==="WLS")?.name).toBe("Wales");
  });
  test("month-end ranges do not overflow into an extra month",()=>{
    expect(discoveryRequest({...defaultDiscoveryFilters(),dates:"1"},new Date(2026,0,31)).to).toBe("2026-02-28");
  });
  test("all dates includes ongoing and past events without changing the chosen area",()=>{
    expect(discoveryRequest({...defaultDiscoveryFilters(),dates:"any",period:"all",region:"UK & Ireland",country:"WLS"}))
      .toMatchObject({from:"1900-01-01",to:"9999-12-31",period:"all",country:"WLS"});
  });
});
