import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildEnginePlanReport } from "@/utils/enginePlanExplorer";
import { EnginePlanEvaluation, EnginePlanHorizonControl } from "./EnginePlanPresentation";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(child: React.ReactNode) {
  await act(async () => root.render(<MantineProvider>{child}</MantineProvider>));
}
test("horizon selector calls its owner and explains each bounded move window", async () => {
  const onChange = vi.fn();
  await render(<EnginePlanHorizonControl value="all" onChange={onChange} />);
  await act(async () => (container.querySelector('[aria-label="Plan horizon"]') as HTMLInputElement).click());
  await act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(option => option.textContent === "Long term")!.click());
  expect(onChange).toHaveBeenCalledWith("long");
  await act(async () => (container.querySelector('[aria-label="Help: Plan horizon"]') as HTMLButtonElement).focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("seven to twelve");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
test("later ideas show a source-qualified conditional score with dismissible keyboard/touch help", async () => {
  const report = buildEnginePlanReport("4k3/7p/8/8/8/8/6K1/R7 b - - 0 20", [
    { multipv: 2, depth: 17, uciMoves: ["h7h6", "a1d1"], sanMoves: [], nodes: 1, nps: 1, score: { value: { type: "cp", value: -31 }, wdl: null } },
    { multipv: 5, depth: 19, uciMoves: ["h7h5", "a1d1"], sanMoves: [], nodes: 1, nps: 1, score: { value: { type: "cp", value: -40 }, wdl: null } },
  ], { requestedMultipv: 5, limitLabel: "Depth 17" });
  const plan = report.displayPlans.find(plan => plan.color === "white")!;
  await render(<EnginePlanEvaluation plan={plan} />);
  expect(container.textContent).toContain("-0.31"); expect(container.textContent).toContain("Conditional · PV2");
  await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
  const tooltip = document.querySelector('[role="tooltip"]');
  expect(tooltip?.textContent).toContain("supporting PV2, at depth 17, from White's perspective");
  expect(tooltip?.textContent).toContain("does not independently evaluate");
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await render(<EnginePlanEvaluation plan={{ ...plan, evidence: [] }} />);
  expect(container.querySelector("p")?.textContent).toBe("Unavailable");
});
