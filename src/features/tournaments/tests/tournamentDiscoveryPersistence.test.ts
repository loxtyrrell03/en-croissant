import {afterEach,expect,test,vi} from "vitest";
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
function storage(){const values=new Map<string,string>();vi.stubGlobal("localStorage",{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});return values;}
test("region and compatible country survive a fresh module without preserving an old query/date",async()=>{
  storage();let model=await import("../tournamentDiscoveryModel");
  model.rememberDiscoveryFilters({...model.defaultDiscoveryFilters(),region:"UK & Ireland",country:"WLS",query:"old",from:"2020-01-01"});
  vi.resetModules();model=await import("../tournamentDiscoveryModel");
  expect(model.initialDiscoveryFilters()).toMatchObject({region:"UK & Ireland",country:"WLS",query:"",period:"upcoming"});
  expect(model.initialDiscoveryFilters().from).not.toBe("2020-01-01");
  model.rememberDiscoveryFilters(model.defaultDiscoveryFilters());vi.resetModules();model=await import("../tournamentDiscoveryModel");
  expect(model.initialDiscoveryFilters()).toMatchObject({region:"",country:""});
});
test.each(['{broken','null','{"region":"Mars","country":"XXX"}','{"region":"Europe","country":"BRA"}'])("invalid saved area is harmless: %s",async saved=>{
  storage().set("outpost.tournaments.area.v1",saved);vi.resetModules();const model=await import("../tournamentDiscoveryModel");
  expect(model.initialDiscoveryFilters().country).toBe("");
});
test("denied browser storage preserves session choices without breaking search",async()=>{
  vi.stubGlobal("localStorage",{getItem:()=>{throw Error("Denied");},setItem:()=>{throw Error("Denied");}});
  const model=await import("../tournamentDiscoveryModel");expect(model.initialDiscoveryFilters().region).toBe("");
  model.rememberDiscoveryFilters({...model.defaultDiscoveryFilters(),region:"Europe"});expect(model.initialDiscoveryFilters().region).toBe("Europe");
});
