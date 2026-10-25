import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { commands, type LocalEvalSourceChanged } from "@/bindings";
import { noteEvaluationSourceRevision } from "@/utils/evaluationSource";

/** Read-only startup/focus checks also observe choices made by another native process. */
export function useEvaluationSourceSelection(enabled: boolean) {
    useEffect(() => {
        if (!enabled) return;
        let disposed = false,
            sequence = 0;
        const refresh = async () => {
            const owned = ++sequence;
            try {
                const response = await commands.getLocalEvalSourceSelection();
                if (disposed || owned !== sequence) return;
                noteEvaluationSourceRevision(
                    response.status === "ok" ? response.data.revision : "unavailable",
                );
            } catch {
                if (!disposed && owned === sequence) noteEvaluationSourceRevision("unavailable");
            }
        };
        const unlisten = listen<LocalEvalSourceChanged>(
            "local-eval-source-changed",
            ({ payload }) => {
                if (!disposed && typeof payload?.selection?.revision === "string") {
                    sequence += 1;
                    noteEvaluationSourceRevision(payload.selection.revision);
                }
            },
        ).catch(() => () => {});
        void refresh();
        const visible = () => {
            if (document.visibilityState === "visible") void refresh();
        };
        window.addEventListener("focus", visible);
        document.addEventListener("visibilitychange", visible);
        const timer = window.setInterval(visible, 15_000);
        return () => {
            disposed = true;
            window.clearInterval(timer);
            window.removeEventListener("focus", visible);
            document.removeEventListener("visibilitychange", visible);
            void unlisten.then((stop) => stop()).catch(() => {});
        };
    }, [enabled]);
}
