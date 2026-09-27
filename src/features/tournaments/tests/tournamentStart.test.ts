import { describe, expect, test } from "vitest";
import { tournamentCountdown } from "../tournamentStart";

const now = new Date(2026, 8, 12, 12).getTime();
const unknown = { date:null, time:null, startsAt:null };
describe("tournament countdown", () => {
  test("uses published calendar days without inventing midnight", () => {
    expect(tournamentCountdown({dateRange:"2026/09/13",roundOneStart:unknown},now)).toMatchObject({label:"Starts tomorrow",dateTime:"2026-09-13"});
    expect(tournamentCountdown({dateRange:"2026/09/13",roundOneStart:unknown},now)?.detail).toContain("time not published");
    expect(tournamentCountdown({dateRange:"2026/09/14 to 2026/09/16"},now)?.label).toBe("Starts in 2 days");
    expect(tournamentCountdown({dateRange:"2026/09/12"},now)?.label).toBe("Starts today");
  });
  test("distinguishes an unavailable schedule from a published unknown time", () => {
    expect(tournamentCountdown({dateRange:"2026/09/13"},now)?.detail).toContain("start time unavailable");
    expect(tournamentCountdown({dateRange:"2026/09/13",roundOneStart:unknown},now)?.detail).toContain("time not published");
  });
  test("counts down to an offset-qualified start in days and hours", () => {
    const info={dateRange:"2026/09/13",roundOneStart:{date:"2026-09-13",time:"09:00",startsAt:"2026-09-13T09:00:00-03:00"}};
    expect(tournamentCountdown(info,Date.parse("2026-09-12T09:00:00Z"))?.label).toBe("Round 1 in 1 day 3 hours");
    expect(tournamentCountdown(info,Date.parse("2026-09-13T10:30:00Z"))?.label).toBe("Round 1 in 1 hour 30 min");
    expect(tournamentCountdown(info,Date.parse("2026-09-13T11:59:30Z"))?.label).toBe("Round 1 in 1 min");
    expect(tournamentCountdown(info,Date.parse("2026-09-13T12:00:00Z"))?.label).toBe("Round 1 start time passed");
  });
  test("explicit offsets handle DST without assuming every day is 24 hours", () => {
    const info={dateRange:"2026/10/25",roundOneStart:{...unknown,startsAt:"2026-10-25T10:00:00Z"}};
    expect(tournamentCountdown(info,Date.parse("2026-10-24T10:00:00+01:00"))?.label).toBe("Round 1 in 1 day 1 hour");
  });
  test("does not interpret event-local time in the viewer's zone", () => {
    const info={dateRange:"2026/09/13",roundOneStart:{date:"2026-09-13",time:"09:00",startsAt:"2026-09-13T09:00:00"}};
    expect(tournamentCountdown(info,now)).toMatchObject({label:"Starts tomorrow"});
    expect(tournamentCountdown(info,now)?.detail).toContain("09:00 event local time · time zone unavailable");
  });
  test("prefers the round-one date over an event's opening day", () => {
    expect(tournamentCountdown({dateRange:"2026/09/12",roundOneStart:{...unknown,date:"2026-09-14"}},now)?.label).toBe("Starts in 2 days");
  });
  test.each([null,"Unknown","2026/02/30","2026/13/01","2026/09/31"])("handles a missing or invalid date: %s", dateRange => {
    expect(tournamentCountdown({dateRange},now)?.label).toBe("Start date not published");
  });
  test("does not treat a past scheduled date as proof that play began", () => {
    expect(tournamentCountdown({dateRange:"2026/09/11"},now)?.label).toBe("Start date passed");
  });
  test("keeps the countdown when round-one pairings are published, retires it when play begins", () => {
    const info={dateRange:"2026/09/13",publishedRound:1};
    expect(tournamentCountdown(info,now)?.label).toBe("Starts tomorrow");
    expect(tournamentCountdown({...info,liveRound:1},now)).toBeNull();
    expect(tournamentCountdown({...info,completedRound:1},now)).toBeNull();
    expect(tournamentCountdown({...info,phase:"complete"},now)).toBeNull();
  });
});
