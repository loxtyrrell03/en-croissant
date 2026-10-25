import { Blob as NativeBlob } from "node:buffer";
import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PhoneAnnotationBar from "../PhoneAnnotationBar";
import { parsePgnDatabase } from "../pgn";

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const game = parsePgnDatabase(
  "Export fixture",
  '[White "One"]\n[Black "Two"]\n[Result "*"]\n[PersonalSyncRef "fixture-ref"]\n[PersonalSyncRevision "fixture-revision"]\n{Saved root note} 1. e4 {Saved note [%cal Ge2e4]} (1. d4 d5) e5 *',
  1,
).games[0];
const create = vi.fn(),
  revoke = vi.fn(),
  request = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("Blob", NativeBlob);
  create.mockReset().mockReturnValue("blob:export-fixture");
  revoke.mockReset();
  request.mockReset();
  const OriginalUrl = URL;
  vi.stubGlobal(
    "URL",
    class extends OriginalUrl {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      request({ connected: this.isConnected, filename: this.download, url: this.href });
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render() {
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <PhoneAnnotationBar game={game} onChange={vi.fn()} />
      </MantineProvider>,
    ),
  );
}
async function download() {
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("PGN"))!
      .click(),
  );
}

it("requests the complete immutable PGN and releases the owned browser URL", async () => {
  await render();
  const original = game.pgn;
  await download();
  const blob = create.mock.calls[0][0] as NativeBlob;
  expect(await blob.text()).toBe(original);
  expect(request).toHaveBeenCalledWith({
    connected: true,
    filename: "One-Two.pgn",
    url: "blob:export-fixture",
  });
  expect(document.querySelector("a[download]")).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(revoke).toHaveBeenCalledWith("blob:export-fixture");
  expect(game.pgn).toBe(original);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("shows creation failure without changing the game and permits retry", async () => {
  create.mockImplementationOnce(() => {
    throw new Error("Fixture browser storage unavailable");
  });
  await render();
  const original = game.pgn;
  await download();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Fixture browser storage unavailable",
  );
  expect(request).not.toHaveBeenCalled();
  expect(game.pgn).toBe(original);
  await download();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});
it("removes staging elements and releases the URL when browser dispatch fails", async () => {
  request.mockImplementation(() => {
    throw new Error("Fixture download refused");
  });
  await render();
  await download();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Fixture download refused");
  expect(revoke).toHaveBeenCalledWith("blob:export-fixture");
  expect(document.querySelector("a[download]")).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(revoke).toHaveBeenCalledTimes(1);
});
