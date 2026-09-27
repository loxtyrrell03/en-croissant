import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const METHODS = new Set([
  "fetchTournamentSnapshot",
  "searchTournaments",
  "discoverTournaments",
  "tournamentEventMetadata",
  "settingsGet",
  "settingsSet",
  "collectionList",
  "collectionGet",
  "collectionCreate",
  "collectionSetFolder",
  "collectionSetDescription",
  "collectionUpdate",
  "collectionForget",
  "dataPackStatus",
  "otbLibraryStatus",
  "checkOtbPackUpdates",
  "reviewDataPack",
  "startDataPack",
  "cancelDataPack",
  "maintainOtbLibrary",
  "setOtbLibraryPreferences",
  "reviewDownloadRemoval",
  "removeDownloadedData",
]);

/** One supervised native worker. Never replay an uncertain mutation automatically. */
export class TournamentService {
  constructor({
    binaryPath,
    root,
    cacheRoot,
    onLog = () => {},
    spawnProcess = spawn,
    timeoutMs = 10 * 60_000,
  }) {
    Object.assign(this, { binaryPath, root, cacheRoot, onLog, spawnProcess, timeoutMs });
    this.child = null;
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
  }
  worker() {
    if (this.closed) throw new Error("The tournament service is shutting down.");
    if (this.child) return this.child;
    const child = this.spawnProcess(this.binaryPath, [this.root, this.cacheRoot], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    const fail = (error) => {
      if (this.child !== child) return;
      this.child = null;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
    };
    child.on("error", (error) =>
      fail(new Error(`Tournament service unavailable: ${error.message}`)),
    );
    child.on("exit", (code) =>
      fail(new Error(`Tournament service stopped (${code}). Retry to read its saved state.`)),
    );
    child.stdin.on("error", (error) =>
      fail(new Error(`Tournament service connection closed: ${error.message}`)),
    );
    child.stderr.on("data", (chunk) => this.onLog(`tournaments: ${String(chunk).slice(-2000)}`));
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const response = JSON.parse(line),
          item = this.pending.get(response.id);
        if (!item) return;
        this.pending.delete(response.id);
        clearTimeout(item.timer);
        if (response.error) item.reject(new Error(String(response.error)));
        else item.resolve(response.result);
      } catch {
        fail(new Error("The tournament service returned an unreadable response."));
        child.kill();
      }
    });
    return child;
  }
  request(request) {
    if (!request || !METHODS.has(request.method))
      return Promise.reject(new Error("Unknown tournament operation."));
    let child;
    try {
      child = this.worker();
    } catch (error) {
      return Promise.reject(error);
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error("The PC has not confirmed this operation. Check saved state before retrying."),
        );
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ id, method: request.method, params: request.params ?? {} }) + "\n",
        (error) => {
          if (error) {
            const item = this.pending.get(id);
            if (item) {
              clearTimeout(item.timer);
              this.pending.delete(id);
              item.reject(error);
            }
          }
        },
      );
    });
  }
  close() {
    this.closed = true;
    this.child?.stdin.end();
  }
}
