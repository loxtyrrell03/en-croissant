import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNativePgnOpening } from "./useNativePgnOpening";

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  stop: vi.fn(),
  setTabs: vi.fn(),
  setActive: vi.fn(),
}));
vi.mock("@/state/atoms", () => ({ tabsAtom: "tabs", activeTabAtom: "active" }));
vi.mock("jotai", () => ({
  useSetAtom: (key: string) => (key === "tabs" ? mocks.setTabs : mocks.setActive),
}));
vi.mock("@/utils/shellPgnOpening", () => ({ installNativePgnOpening: mocks.install }));
let root: Root | undefined;
function Probe({ ready }: { ready: boolean }) {
  useNativePgnOpening(ready);
  return null;
}
async function render(ready: boolean) {
  await act(async () => root!.render(<Probe ready={ready} />));
}
async function unmount() {
  if (!root) return;
  await act(async () => root!.unmount());
  root = undefined;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.install.mockReturnValue(mocks.stop);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="shell-hook"></div>';
  root = createRoot(document.getElementById("shell-hook")!);
});
afterEach(async () => {
  await unmount();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("retains shell requests until actual startup readiness and releases its subscription on unmount", async () => {
  await render(false);
  expect(mocks.install).not.toHaveBeenCalled();
  await render(true);
  expect(mocks.install).toHaveBeenCalledExactlyOnceWith(mocks.setTabs, mocks.setActive);
  await render(true);
  expect(mocks.install).toHaveBeenCalledOnce();
  await unmount();
  expect(mocks.stop).toHaveBeenCalledOnce();
});

it("releases ownership whenever readiness is withdrawn and subscribes again when ready", async () => {
  await render(true);
  await render(false);
  expect(mocks.stop).toHaveBeenCalledOnce();
  await render(true);
  expect(mocks.install).toHaveBeenCalledTimes(2);
  await unmount();
  expect(mocks.stop).toHaveBeenCalledTimes(2);
});
