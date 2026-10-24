import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import { saveToFile, type Tab } from "@/utils/tabs";
import ConfirmChangesModal from "./ConfirmChangesModal";

vi.mock("@tanstack/react-router", () => ({ useLoaderData: () => ({ documentDir: "/fixture" }) }));
vi.mock("@/utils/tabs", () => ({ saveToFile: vi.fn() }));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
beforeEach(() => {
  vi.mocked(saveToFile).mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());
async function mount() {
  const tab: Tab = {
    value: "owner",
    name: "Original game",
    type: "analysis",
    gameOrigin: { kind: "none" },
  };
  const store = createTreeStore();
  store.getState().setComment("Keep this");
  const closeTab = vi.fn(),
    onClose = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MantineProvider>
        <ConfirmChangesModal
          opened
          tab={tab}
          store={store}
          target={{ get: () => tab, update: () => {} }}
          closeTab={closeTab}
          onClose={onClose}
        />
      </MantineProvider>,
    ),
  );
  return {
    tab,
    store,
    closeTab,
    onClose,
    click: async () =>
      act(async () =>
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent === "Save and Close")!
          .click(),
      ),
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("waits for the save before closing the captured game", async () => {
  const view = await mount();
  let finish!: (value: boolean) => void;
  vi.mocked(saveToFile).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await view.click();
    expect(view.closeTab).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(vi.mocked(saveToFile).mock.calls[0][0].tab?.value).toBe("owner");
    await act(async () => {
      view.store.getState().save();
      finish(true);
    });
    expect(view.closeTab).toHaveBeenCalledOnce();
    expect(view.onClose).toHaveBeenCalledOnce();
  } finally {
    await view.dispose();
  }
});

it("keeps a cancelled or failed save open and offers a working retry", async () => {
  const view = await mount();
  vi.mocked(saveToFile).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("Disk full"));
  try {
    await view.click();
    expect(view.closeTab).not.toHaveBeenCalled();
    await view.click();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    expect(view.store.getState().dirty).toBe(true);
    vi.mocked(saveToFile).mockImplementation(async () => {
      view.store.getState().save();
      return true;
    });
    await view.click();
    expect(view.closeTab).toHaveBeenCalledOnce();
  } finally {
    await view.dispose();
  }
});

it("keeps newer edits open when only the earlier snapshot was saved", async () => {
  const view = await mount();
  vi.mocked(saveToFile).mockImplementation(async () => {
    view.store.getState().setComment("Newer edits");
    return true;
  });
  try {
    await view.click();
    expect(view.closeTab).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("newer changes");
    expect(view.store.getState().root.comment).toBe("Newer edits");
  } finally {
    await view.dispose();
  }
});
