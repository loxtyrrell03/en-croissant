import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { warn } from "@tauri-apps/plugin-log";
import { openFile } from "./files";

// Native requests are retained before subscription. Once taken, this module
// keeps their order across root cleanup and an in-flight protected file read.
const pendingPaths: string[] = [];
let work: Promise<void> = Promise.resolve();
let activeOwner: AbortController | undefined;

export function installNativePgnOpening(
    setTabs: Parameters<typeof openFile>[1],
    setActiveTab: Parameters<typeof openFile>[2],
): () => void {
    if (!("__TAURI_INTERNALS__" in window) || !window.__TAURI_INTERNALS__) return () => {};
    activeOwner?.abort();
    const owner = new AbortController();
    activeOwner = owner;
    let unlisten: (() => void) | undefined;
    owner.signal.addEventListener("abort", () => unlisten?.(), { once: true });

    function report(error: unknown, path?: string) {
        void warn(`Could not open requested PGN: ${String(error)}`).catch(() => {});
        notifications.show({
            color: "red",
            title: "Could not open PGN",
            message: path ? `${path}: ${String(error)}` : "Try opening the file again.",
        });
    }

    function drain() {
        work = work
            .then(async () => {
                if (owner.signal.aborted) return;
                try {
                    // Keep the returned batch even if cleanup happened during IPC.
                    pendingPaths.push(...(await invoke<string[]>("take_shell_open_paths")));
                } catch (error) {
                    if (!owner.signal.aborted) report(error);
                }
                while (!owner.signal.aborted && pendingPaths.length) {
                    const path = pendingPaths[0];
                    try {
                        await openFile(path, setTabs, setActiveTab, { signal: owner.signal });
                        // A completed commit belongs to the old owner even if cleanup
                        // followed it; do not open that file twice after remount.
                        pendingPaths.shift();
                    } catch (error) {
                        if (owner.signal.aborted) return;
                        pendingPaths.shift();
                        report(error, path);
                    }
                }
            })
            .catch((error) => {
                if (!owner.signal.aborted) report(error);
            });
    }

    void listen("shell://open-paths", drain)
        .then((stop) => {
            if (owner.signal.aborted) {
                stop();
                return;
            }
            unlisten = stop;
            drain();
        })
        .catch((error) => {
            if (!owner.signal.aborted) report(error);
        });

    return () => {
        owner.abort();
        if (activeOwner === owner) activeOwner = undefined;
    };
}
