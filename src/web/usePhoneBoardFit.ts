import { useEffect, useRef } from "react";

/** Fit the ordinary Live view without hiding controls or changing analysis settings. */
export function usePhoneBoardFit(active: boolean) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const root = ref.current;
        if (!root || !active) return;
        const board = root.querySelector<HTMLElement>("[data-board-area]");
        const engine = root.querySelector<HTMLElement>("[data-live-engine-panel]");
        if (!board || !engine) return;
        let frame = 0;
        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const rect = root.getBoundingClientRect();
                const boardRect = board.getBoundingClientRect();
                const surface = board.lastElementChild?.getBoundingClientRect();
                if (!surface) return;
                const main = root.closest("main");
                const bottomPadding = main
                    ? parseFloat(getComputedStyle(main).paddingBottom) || 0
                    : 0;
                const viewport =
                    window.visualViewport?.scale === 1
                        ? window.visualViewport.height
                        : window.innerHeight;
                const remaining =
                    viewport -
                    (rect.top + window.scrollY) -
                    (engine.getBoundingClientRect().bottom - rect.top - boardRect.height) -
                    bottomPadding;
                // Keep the board usable with enlarged text, open settings or an error.
                // Those exceptional views can still scroll; never clip their controls.
                const width =
                    Math.max(176, Math.floor(remaining)) + boardRect.width - surface.width;
                const value = `${width}px`;
                if (root.style.getPropertyValue("--phone-board-fit") !== value)
                    root.style.setProperty("--phone-board-fit", value);
            });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(root);
        observer.observe(board);
        observer.observe(engine);
        for (const element of root.closest("main")?.parentElement?.children ?? [])
            observer.observe(element);
        window.addEventListener("resize", measure);
        window.visualViewport?.addEventListener("resize", measure);
        measure();
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener("resize", measure);
            window.visualViewport?.removeEventListener("resize", measure);
            root.style.removeProperty("--phone-board-fit");
        };
    }, [active]);
    return ref;
}
