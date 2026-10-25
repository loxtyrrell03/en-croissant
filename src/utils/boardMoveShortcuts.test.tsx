// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { bindBoardMoveShortcuts } from "./boardMoveShortcuts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.replaceChildren();
});

function setup(markup = '<button aria-label="Board">Board</button>') {
  document.body.innerHTML = markup;
  const next = vi.fn(), previous = vi.fn();
  cleanups.push(bindBoardMoveShortcuts(next, previous));
  return { next, previous };
}
function press(target: EventTarget, key = "ArrowRight", options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

it.each([
  '<input value="filename.pgn">',
  '<textarea>Notes</textarea>',
  '<select><option>Database</option></select>',
  '<div contenteditable><span>Notes</span></div>',
  '<div contenteditable="plaintext-only"><span>Notes</span></div>',
  '<div role="textbox"><span>Notes</span></div>',
  '<button role="combobox"><span>Database</span></button>',
  '<div role="spinbutton" tabindex="0">1</div>',
  '<div role="slider" tabindex="0">Strength</div>',
  '<div role="separator" tabindex="0">Resize</div>',
  '<button aria-haspopup="menu"><span>Actions</span></button>',
  '<button aria-haspopup="true"><span>Actions</span></button>',
  '<button role="tab">Analysis</button>',
  '<div role="treeitem" tabindex="0">Files</div>',
  '<div role="radio" tabindex="0">Preset</div>',
  '<div role="listbox"><div role="option" tabindex="0">Database</div></div>',
  '<div role="menu"><button role="menuitem"><span>Export</span></button></div>',
  '<div role="dialog"><button>Retry</button></div>',
])("leaves control navigation and bubbling intact: %s", (markup) => {
  const { next, previous } = setup(markup);
  const target = document.body.querySelector("span") ?? document.body.firstElementChild!;
  const own = vi.fn(); target.addEventListener("keydown", own);
  const right = press(target), left = press(target, "ArrowLeft");
  expect(next).not.toHaveBeenCalled(); expect(previous).not.toHaveBeenCalled();
  expect(own).toHaveBeenCalledTimes(2);
  expect(right.defaultPrevented).toBe(false); expect(left.defaultPrevented).toBe(false);
});

it("lets a focused resize control receive its navigation before any move changes", () => {
  const { next } = setup('<div role="separator" tabindex="0">Resize</div>');
  const control = document.body.firstElementChild!;
  let height = 200;
  control.addEventListener("keydown", (event) => { height += 10; event.preventDefault(); });
  press(control);
  expect(height).toBe(210); expect(next).not.toHaveBeenCalled();
});

it("finds the menu trigger when its SVG icon receives the key", () => {
  const { next } = setup('<button aria-haspopup="menu"><svg><path d="M0 0"/></svg></button>');
  press(document.querySelector("path")!);
  expect(next).not.toHaveBeenCalled();
});

it("yields while a modal owns focus even when its focus trap is settling", () => {
  const { next } = setup('<button id="board">Board</button><div role="dialog" aria-modal="true">Settings</div>');
  press(document.querySelector("#board")!);
  expect(next).not.toHaveBeenCalled();
});

it("does not let a hidden retained dialog disable board navigation", () => {
  const { next } = setup('<button id="board">Board</button><div hidden><div role="dialog" aria-modal="true">Settings</div></div>');
  press(document.querySelector("#board")!);
  expect(next).toHaveBeenCalledOnce();
});

it("respects an open native dialog", () => {
  const { next } = setup('<button id="board">Board</button><dialog open>Settings</dialog>');
  press(document.querySelector("#board")!); expect(next).not.toHaveBeenCalled();
});

it.each(['aria-hidden="true"', "inert"])("ignores an inactive retained modal marked %s", (attribute) => {
  const { next } = setup(`<button id="board">Board</button><div ${attribute}><div role="dialog" aria-modal="true">Settings</div></div>`);
  press(document.querySelector("#board")!); expect(next).toHaveBeenCalledOnce();
});

it("preserves editing inside a shadow-root control", () => {
  const { next } = setup('<div id="host"></div>');
  const shadow = document.querySelector("#host")!.attachShadow({ mode: "open" });
  shadow.innerHTML = '<input value="Notes">';
  press(shadow.querySelector("input")!, "ArrowRight", { composed: true });
  expect(next).not.toHaveBeenCalled();
});

it("keeps an explicitly ordinary button working", () => {
  const { next } = setup('<button aria-haspopup="false" contenteditable="false">Board</button>');
  press(document.body.firstElementChild!); expect(next).toHaveBeenCalledOnce();
});

it.each(["ArrowRight", "ArrowLeft"])("respects a previously handled %s", (key) => {
  const { next, previous } = setup();
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  event.preventDefault(); document.body.firstElementChild!.dispatchEvent(event);
  expect(next).not.toHaveBeenCalled(); expect(previous).not.toHaveBeenCalled();
});

it("does not navigate during text composition", () => {
  const { next } = setup();
  press(document.body.firstElementChild!, "ArrowRight", { isComposing: true });
  expect(next).not.toHaveBeenCalled();
});

it("uses the active control when an event is dispatched to the window", () => {
  const { next } = setup('<input value="Notes">');
  (document.body.firstElementChild as HTMLInputElement).focus();
  press(window); expect(next).not.toHaveBeenCalled();
});

it.each(["altKey", "ctrlKey", "metaKey", "shiftKey"])("retains the %s shortcut owner", (modifier) => {
  const { next } = setup();
  expect(press(document.body.firstElementChild!, "ArrowRight", { [modifier]: true }).defaultPrevented).toBe(false);
  expect(next).not.toHaveBeenCalled();
});

it("keeps ordinary board/buttons and both move directions working", () => {
  const { next, previous } = setup('<button><span>Board</span></button>');
  const target = document.querySelector("span")!;
  expect(press(target).defaultPrevented).toBe(true);
  expect(press(target, "ArrowLeft").defaultPrevented).toBe(true);
  expect(next).toHaveBeenCalledOnce(); expect(previous).toHaveBeenCalledOnce();
});

it("cleans the capture listener on unmount and uses the latest callbacks on remount", () => {
  function Mounted({ next }: { next: () => void }) {
    useEffect(() => bindBoardMoveShortcuts(next, () => {}), [next]);
    return <button id="board">Board</button>;
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), first = vi.fn(), second = vi.fn();
  act(() => root.render(<Mounted next={first} />));
  press(document.querySelector("#board")!);
  act(() => root.render(<Mounted next={second} />));
  press(document.querySelector("#board")!);
  act(() => root.unmount());
  press(window);
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
});
