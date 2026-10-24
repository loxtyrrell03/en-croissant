import { expect, it } from "vitest";
import { statsPerformanceFetchRequest } from "../statsRating";

it("keeps exact custom hours, fractional days and weeks in the phone fetch", () => {
  expect(statsPerformanceFetchRequest("1d")).toEqual({ maxGames: 5000, maxDays: 1 });
  expect(statsPerformanceFetchRequest("3d")).toEqual({ maxGames: 5000, maxDays: 3 });
  expect(statsPerformanceFetchRequest("12h")).toEqual({ maxGames: 5000, maxDays: 0.5 });
  expect(statsPerformanceFetchRequest("1.5d")).toEqual({ maxGames: 5000, maxDays: 1.5 });
  expect(statsPerformanceFetchRequest("2w")).toEqual({ maxGames: 5000, maxDays: 14 });
});
