function controlOwnsArrowKeys(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return true;
  // Capture listeners run before a focused control can handle its own key.
  // Include SVG children and controls inside an open shadow root.
  const target = event.composedPath().find((node) => node instanceof Element) ??
    (document.activeElement instanceof Element ? document.activeElement : null);
  if (target instanceof Element && target.closest([
    "input", "textarea", "select",
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]', '[role="combobox"]', '[role="spinbutton"]',
    '[role="slider"]', '[role="separator"]', '[role="tab"]', '[role="tablist"]',
    '[role="tree"]', '[role="treeitem"]', '[role="grid"]', '[role="toolbar"]',
    '[role="radio"]', '[role="radiogroup"]', '[role="menu"]', '[role="menuitem"]',
    '[role="listbox"]', '[role="option"]', '[role="dialog"]', '[role="alertdialog"]',
    '[aria-haspopup]:not([aria-haspopup="false"])',
  ].join(","))) return true;
  return Array.from(document.querySelectorAll('[aria-modal="true"], dialog[open]')).some(
    (modal) => !modal.closest('[hidden], [aria-hidden="true"], [inert]'),
  );
}

export function bindBoardMoveShortcuts(next: () => void, previous: () => void) {
  const navigate = (event: KeyboardEvent) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.key !== "ArrowRight" && event.key !== "ArrowLeft") ||
      controlOwnsArrowKeys(event)
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "ArrowRight") next();
    else previous();
  };
  window.addEventListener("keydown", navigate, { capture: true });
  return () => window.removeEventListener("keydown", navigate, { capture: true });
}
