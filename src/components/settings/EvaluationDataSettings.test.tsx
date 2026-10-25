import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  LocalEvalBuildJob,
  LocalEvalDbStatus,
  LocalEvalDownloadReview,
  LocalEvalSourceCandidate,
} from "@/bindings";
import EvaluationDataSettings from "./EvaluationDataSettings";

const io = vi.hoisted(() => ({
  selection: { path: "C:/Fixture/current", revision: "before" },
  status: null as any,
  job: null as any,
  checked: null as any,
  getLocalEvalSourceSelection: vi.fn(),
  getLocalLichessEvalDbStatus: vi.fn(),
  getLocalEvalBuildJob: vi.fn(),
  validateLocalEvalSource: vi.fn(),
  activateLocalEvalSource: vi.fn(),
  reviewLocalEvalDownload: vi.fn(),
  startLocalEvalDownload: vi.fn(),
  cancelLocalLichessEvalDb: vi.fn(),
  discardLocalEvalBuildJob: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/bindings", async (original) => {
  const bindings = await original<typeof import("@/bindings")>();
  return {
    ...bindings,
    commands: {
      ...bindings.commands,
      ...Object.fromEntries(Object.entries(io).filter(([, entry]) => typeof entry === "function")),
    },
  };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: io.open }));
const ok = <T,>(data: T) => ({ status: "ok", data });
const initial: LocalEvalDbStatus = {
  available: true,
  path: "C:/Fixture/current",
  positions: BigInt(123),
  shardCount: 16,
  maxPvs: 5,
  storageBytes: BigInt(2048),
  error: null,
};
const review: LocalEvalDownloadReview = {
  token: "review-1",
  outputDir: "C:/Fixture/new",
  source: "https://fixture.invalid/archive.zst",
  downloadBytes: BigInt(1024),
  availableBytes: BigInt(100000000000),
  diskLimitBytes: BigInt(68719476736),
  reserveBytes: BigInt(268435456),
};
const running = (id = "review-1"): LocalEvalBuildJob => ({
  id,
  outputDir: "C:/Fixture/new",
  state: "running",
  active: true,
  canCancel: true,
  detail: null,
  report: null,
  store: null,
  progress: {
    id,
    phase: "ingesting",
    progress: 10,
    positions: BigInt(1),
    skipped: BigInt(0),
    compressedBytesRead: BigInt(100),
    compressedBytesTotal: BigInt(1024),
    finished: false,
  },
});
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  io.selection = { path: initial.path, revision: "before" };
  io.status = { ...initial };
  io.job = null;
  io.checked = null;
  for (const entry of Object.values(io)) if (typeof entry === "function") entry.mockReset();
  io.getLocalEvalSourceSelection.mockImplementation(async () => ok({ ...io.selection }));
  io.getLocalLichessEvalDbStatus.mockImplementation(async () => ok({ ...io.status }));
  io.getLocalEvalBuildJob.mockImplementation(async () => ok(io.job));
  io.open.mockResolvedValue("C:/Fixture/chosen");
  io.validateLocalEvalSource.mockImplementation(async (path) => {
    io.checked = {
      token: "checked",
      store: { ...initial, path, positions: BigInt(456) },
    } satisfies LocalEvalSourceCandidate;
    return ok(io.checked);
  });
  io.activateLocalEvalSource.mockImplementation(async () => {
    io.selection = { path: io.checked.store.path, revision: "after" };
    io.status = io.checked.store;
    return ok({ ...io.selection });
  });
  io.reviewLocalEvalDownload.mockResolvedValue(ok(review));
  io.startLocalEvalDownload.mockImplementation(async (id) => {
    io.job = running(id);
    return ok(id);
  });
  io.cancelLocalLichessEvalDb.mockImplementation(async () => {
    io.job = { ...io.job, state: "cancelled", active: false, canCancel: false };
    return true;
  });
  io.discardLocalEvalBuildJob.mockImplementation(async () => {
    io.job = null;
    return ok(null);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(visible = true) {
  await act(async () =>
    root.render(
      <MantineProvider
        env="test"
        theme={{ components: { Modal: { defaultProps: { transitionProps: { duration: 0 } } } } }}
      >
        {visible && <EvaluationDataSettings />}
      </MantineProvider>,
    ),
  );
}
function button(label: string) {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("checks current data without reviewing, starting or changing a store", async () => {
  await render();
  expect(host.textContent).toContain("123 positions");
  expect(io.reviewLocalEvalDownload).not.toHaveBeenCalled();
  expect(io.startLocalEvalDownload).not.toHaveBeenCalled();
  expect(io.activateLocalEvalSource).not.toHaveBeenCalled();
});
it("validates a picked folder and waits for the explicit Use action", async () => {
  await render();
  await click("Choose folder");
  expect(io.validateLocalEvalSource).toHaveBeenCalledWith("C:/Fixture/chosen", "before");
  expect(document.body.textContent).toContain("456 positions");
  expect(io.activateLocalEvalSource).not.toHaveBeenCalled();
  await click("Use evaluations");
  expect(io.activateLocalEvalSource).toHaveBeenCalledTimes(1);
  expect(io.activateLocalEvalSource).toHaveBeenCalledWith("checked");
  expect(host.textContent).toContain("C:/Fixture/chosen");
});
it("leaves a cancelled picker and a rejected candidate unselected", async () => {
  io.open.mockResolvedValueOnce(null);
  await render();
  await click("Choose folder");
  expect(io.validateLocalEvalSource).not.toHaveBeenCalled();
  io.validateLocalEvalSource.mockResolvedValueOnce({
    status: "error",
    error: "Invented incomplete folder",
  });
  await click("Choose folder");
  expect(document.body.textContent).toContain("Invented incomplete folder");
  expect(button("Use evaluations").disabled).toBe(true);
  expect(io.activateLocalEvalSource).not.toHaveBeenCalled();
  expect(host.textContent).toContain(initial.path);
});
it("keeps a failed save retryable without selecting the rejected path", async () => {
  await render();
  await click("Choose folder");
  io.activateLocalEvalSource.mockResolvedValueOnce({
    status: "error",
    error: "Invented settings write failure",
  });
  await click("Use evaluations");
  expect(host.textContent).toContain(initial.path);
  expect(document.body.textContent).toContain("Invented settings write failure");
  await click("Use evaluations");
  expect(io.activateLocalEvalSource).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("C:/Fixture/chosen");
});
it("reviews first, then starts once; close and remount retain native work", async () => {
  await render();
  await click("Download details");
  await click("Review download");
  expect(io.reviewLocalEvalDownload).toHaveBeenCalledWith(
    expect.stringContaining("current-download-"),
    64,
  );
  expect(document.body.textContent).toContain("Archive download: 1 KiB");
  expect(io.startLocalEvalDownload).not.toHaveBeenCalled();
  await click("Start download");
  expect(io.startLocalEvalDownload).toHaveBeenCalledWith("review-1");
  await click("Close view");
  await render(false);
  expect(io.cancelLocalLichessEvalDb).not.toHaveBeenCalled();
  await render();
  await click("Download details");
  expect(document.body.textContent).toContain("Reading evaluations");
  expect(io.startLocalEvalDownload).toHaveBeenCalledTimes(1);
  await click("Cancel build");
  expect(io.cancelLocalLichessEvalDb).toHaveBeenCalledWith("review-1");
  expect(document.body.textContent).toContain("Build cancelled");
});
it("queues an explicit cancellation made before Start is acknowledged", async () => {
  const ack = deferred<ReturnType<typeof ok<string>>>();
  io.startLocalEvalDownload.mockReturnValueOnce(ack.promise);
  await render();
  await click("Download details");
  await click("Review download");
  await click("Start download");
  await click("Cancel build");
  expect(io.cancelLocalLichessEvalDb).not.toHaveBeenCalled();
  io.job = running();
  await act(async () => ack.resolve(ok("review-1")));
  expect(io.cancelLocalLichessEvalDb).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("Build cancelled");
});

it("recovers the job after a lost Start reply without replaying a download", async () => {
  io.startLocalEvalDownload.mockImplementationOnce(async (id) => {
    io.job = running(id);
    throw new Error("Invented lost acknowledgement");
  });
  await render();
  await click("Download details");
  await click("Review download");
  await click("Start download");
  expect(document.body.textContent).toContain("Invented lost acknowledgement");
  expect(document.body.textContent).toContain("Reading evaluations");
  expect(io.startLocalEvalDownload).toHaveBeenCalledTimes(1);
  await click("Cancel build");
  expect(io.cancelLocalLichessEvalDb).toHaveBeenCalledWith("review-1");
});
it("rejects a late review after the view closes and opens again", async () => {
  const reply = deferred<ReturnType<typeof ok<LocalEvalDownloadReview>>>();
  io.reviewLocalEvalDownload.mockReturnValueOnce(reply.promise);
  await render();
  await click("Download details");
  await click("Review download");
  await click("Close view");
  await click("Download details");
  await act(async () => reply.resolve(ok(review)));
  expect(
    Array.from(document.querySelectorAll("button")).some(
      (entry) => entry.textContent === "Start download",
    ),
  ).toBe(false);
  expect(io.startLocalEvalDownload).not.toHaveBeenCalled();
});
it("keeps the last job visible after a failed status check", async () => {
  io.job = running();
  await render();
  io.getLocalEvalBuildJob.mockResolvedValueOnce({
    status: "error",
    error: "Invented status failure",
  });
  await click("Download details");
  expect(document.body.textContent).toContain("Last known build status");
  expect(document.body.textContent).toContain("Invented status failure");
  expect(document.body.textContent).toContain("C:/Fixture/new");
  await click("Retry status");
  expect(document.body.textContent).not.toContain("Invented status failure");
});
it("requires cleanup confirmation and preserves a refusal for retry", async () => {
  io.job = { ...running("interrupted"), state: "interrupted", active: false, canCancel: false };
  await render();
  await click("Download details");
  await click("Remove incomplete build");
  expect(io.discardLocalEvalBuildJob).not.toHaveBeenCalled();
  io.discardLocalEvalBuildJob.mockResolvedValueOnce({
    status: "error",
    error: "Invented ownership change; files kept",
  });
  await click("Remove incomplete");
  expect(io.discardLocalEvalBuildJob).toHaveBeenCalledWith("interrupted");
  expect(document.body.textContent).toContain("files kept");
  await click("Remove incomplete");
  expect(io.discardLocalEvalBuildJob).toHaveBeenCalledTimes(2);
  expect(io.reviewLocalEvalDownload).not.toHaveBeenCalled();
  expect(io.activateLocalEvalSource).not.toHaveBeenCalled();
});
it("validates a completed build before its separate Use action and keeps data help dismissible", async () => {
  io.job = {
    ...running("ready"),
    state: "ready",
    active: false,
    canCancel: false,
    progress: null,
    store: { ...initial, path: "C:/Fixture/new" },
  };
  await render();
  expect(io.activateLocalEvalSource).not.toHaveBeenCalled();
  const help = host.querySelector<HTMLButtonElement>('button[aria-label="About evaluation data"]')!;
  await act(async () => help.focus());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await click("Download details");
  await click("Use evaluations");
  expect(io.validateLocalEvalSource).toHaveBeenCalledWith("C:/Fixture/new", "before");
  expect(io.activateLocalEvalSource).toHaveBeenCalledWith("checked");
});
