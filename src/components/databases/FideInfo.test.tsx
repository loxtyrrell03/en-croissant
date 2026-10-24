import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import FideInfo from "./FideInfo";

const search = vi.hoisted(() => vi.fn());
vi.mock("@/utils/fideApi", () => ({ searchFidePlayers: search }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const players = [{ id: 10001, name: "Example, Alex", federation: "ENG" }, { id: 10002, name: "Example, Alex", federation: "WLS" }];
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  search.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(props: { name: string; fideId?: string; opened?: boolean }) {
  await act(async () => root.render(<MantineProvider><FideInfo opened={props.opened ?? true} setOpened={vi.fn()} {...props} /></MantineProvider>));
}

test("a valid PGN FIDE ID takes precedence over ambiguous player text", async () => {
  search.mockResolvedValue([players[1]]);
  await render({ name: "Example, Alex", fideId: "10002" });
  expect(search).toHaveBeenCalledWith("10002", expect.any(AbortSignal));
  expect(document.querySelector('a[href="https://ratings.fide.com/profile/10002"]')).not.toBeNull();
});
test("ambiguous names require choosing a match and Back restores that choice's focus", async () => {
  search.mockResolvedValue(players);
  await render({ name: "Example, Alex" });
  const matches = document.querySelector('[aria-label="FIDE matches"]');
  expect(matches?.querySelectorAll("button")).toHaveLength(2);
  expect(document.querySelector('a[href^="https://ratings.fide.com/profile/"]')).toBeNull();
  await act(async () => matches!.querySelectorAll<HTMLButtonElement>("button")[1].click());
  expect(document.querySelector('a[href="https://ratings.fide.com/profile/10002"]')).not.toBeNull();
  await act(async () => Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Back to matches")!.click());
  expect(document.activeElement?.textContent).toContain("10002");
});
test("a failed search is visibly retryable and an obsolete result cannot replace a new player", async () => {
  search.mockRejectedValueOnce(new Error("Temporary lookup failure")).mockResolvedValueOnce([players[0]]);
  await render({ name: "Example, Alex" });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Temporary lookup failure");
  await act(async () => Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Retry search")!.click());
  expect(document.querySelector('a[href="https://ratings.fide.com/profile/10001"]')).not.toBeNull();

  let resolveOld!: (value: typeof players) => void;
  search.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce([players[1]]);
  await render({ name: "Previous" });
  const oldSignal = search.mock.calls.at(-1)![1] as AbortSignal;
  await render({ name: "Current" });
  expect(oldSignal.aborted).toBe(true);
  await act(async () => resolveOld([players[0]]));
  expect(document.querySelector('a[href="https://ratings.fide.com/profile/10002"]')).not.toBeNull();
  expect(document.querySelector('a[href="https://ratings.fide.com/profile/10001"]')).toBeNull();
});
