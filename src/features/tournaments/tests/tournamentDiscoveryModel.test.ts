import {describe,expect,test} from "vitest";
import {countries,defaultDiscoveryFilters,discoveryRequest,readableDate} from "../tournamentDiscoveryModel";
describe("tournament discovery filters",()=>{
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
});
