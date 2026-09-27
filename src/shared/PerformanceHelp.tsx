import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./PerformanceHelp.module.css";

/** Compact contextual help. Works in clipped panels, with mouse, keyboard and touch. */
export function PerformanceHelp({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }
  function show() {
    cancelClose();
    setOpen(true);
  }
  function hideSoon() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }
  useEffect(() => () => cancelClose(), []);
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current!.getBoundingClientRect();
    const box = tooltip.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)),
      top:
        anchor.bottom + box.height + 8 <= window.innerHeight
          ? anchor.bottom + 6
          : Math.max(8, anchor.top - box.height - 6),
    });
    const close = () => setOpen(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Dismiss the help before an enclosing dialog handles the same key.
        event.stopPropagation();
        close();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !tooltip.current?.contains(event.target as Node)
      ) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, children]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={hideSoon}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          show();
        }}
      >
        ?
      </button>
      {open && createPortal(
        <span
          ref={tooltip}
          id={id}
          role="tooltip"
          className={styles.tooltip}
          style={position}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
        >
          {children}
        </span>,
        document.body,
      )}
    </>
  );
}
