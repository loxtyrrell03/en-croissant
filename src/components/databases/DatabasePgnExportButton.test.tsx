import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DatabasePgnExportButton from "./DatabasePgnExportButton";

const io = vi.hoisted(() => ({ save: vi.fn(), exportToPgn: vi.fn(), show: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: { exportToPgn: io.exportToPgn } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: io.save }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: io.show } }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  for (const fn of Object.values(io)) fn.mockReset();
  io.save.mockResolvedValue("C:/Fixture/export.pgn");
  io.exportToPgn.mockResolvedValue({ status: "ok", data: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(file = "source-a.db3", visible = true) {
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        {visible && (
          <DatabasePgnExportButton key={file} file={file} title={file} label="Export PGN" />
        )}
      </MantineProvider>,
    ),
  );
}
async function click() {
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("does nothing when the native destination picker is cancelled", async () => {
  io.save.mockResolvedValue(null);
  await render();
  await click();
  expect(io.exportToPgn).not.toHaveBeenCalled();
  expect(io.show).not.toHaveBeenCalled();
  expect(host.querySelector("button")!.disabled).toBe(false);
});
it("shows native errors and permits an explicit successful retry", async () => {
  io.exportToPgn.mockResolvedValueOnce({ status: "error", error: "Fixture unreadable game" });
  await render();
  await click();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Fixture unreadable game");
  expect(io.show).not.toHaveBeenCalled();
  expect(host.querySelector("button")!.disabled).toBe(false);
  await click();
  expect(io.exportToPgn).toHaveBeenCalledWith("source-a.db3", "C:/Fixture/export.pgn");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(io.show).toHaveBeenCalledWith(
    expect.objectContaining({ color: "green", message: "C:/Fixture/export.pgn" }),
  );
});
it("settles loading after an IPC rejection without claiming success", async () => {
  io.exportToPgn.mockRejectedValue(new Error("Fixture bridge unavailable"));
  await render();
  await click();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Fixture bridge unavailable");
  expect(host.querySelector("button")!.disabled).toBe(false);
  expect(io.show).not.toHaveBeenCalled();
});
it("keeps one owned operation while the native reply is pending", async () => {
  const reply = deferred<unknown>();
  io.exportToPgn.mockReturnValue(reply.promise);
  await render();
  await click();
  await click();
  expect(io.exportToPgn).toHaveBeenCalledTimes(1);
  await act(async () => reply.resolve({ status: "ok", data: null }));
  expect(host.querySelector("button")!.disabled).toBe(false);
  expect(io.show).toHaveBeenCalledTimes(1);
});
it("retains the original database across picker delays and reports late errors with its name", async () => {
  const picker = deferred<string>();
  io.save.mockReturnValue(picker.promise);
  await render();
  await click();
  await render("source-b.db3");
  io.exportToPgn.mockResolvedValue({ status: "error", error: "Fixture old export failed" });
  await act(async () => picker.resolve("C:/Fixture/old-export.pgn"));
  expect(io.exportToPgn).toHaveBeenCalledWith("source-a.db3", "C:/Fixture/old-export.pgn");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(io.show).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Could not export source-a.db3",
      color: "red",
      autoClose: false,
    }),
  );
});
