import { expect, test } from "vitest";
import { getOtbCoverage, otbCoverageWarning } from "../otbCoverage";

test("requires explicit complete coverage and retains partial/legacy/cancelled distinctions", () => {
  expect(getOtbCoverage({coverageComplete:true,coverageGaps:[]}).status).toBe("complete");
  expect(getOtbCoverage({coverageComplete:true,coverageGaps:["TWIC unavailable"]}).status).toBe("partial");
  expect(getOtbCoverage({coverageComplete:false}).status).toBe("partial");
  expect(getOtbCoverage(null).status).toBe("unknown");
  expect(getOtbCoverage({}).status).toBe("unknown");
  expect(getOtbCoverage({coverageComplete:true,cancelled:true}).status).toBe("stopped");
  expect(otbCoverageWarning(getOtbCoverage({}))).toContain("not recorded");
  expect(otbCoverageWarning(getOtbCoverage({coverageComplete:true}))).toBeNull();
});
test("keeps the unavailable source and reason while removing challenge-page HTML", () => {
  const coverage=getOtbCoverage({coverageComplete:false,coverageGaps:['Lichess live FIDE broadcasts: Lichess returned 403 Forbidden for https://lichess.org/fide/123/player: <!DOCTYPE html><html><title>Just a moment</title>',"TWIC: 429 Too many requests"]});
  expect(coverage.gaps).toEqual(["Lichess live FIDE broadcasts: access was refused (403).","TWIC: the source asked us to slow down (429)."]);
});
