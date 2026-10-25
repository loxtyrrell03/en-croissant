/** Smooth wheel steps in the nearest scrollable surface, including portals. */
export function installPanelScrolling(): () => void {
  if (typeof window.matchMedia !== "function" || typeof requestAnimationFrame !== "function")
    return () => {};
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active: HTMLElement | null = null;
  let target = 0;
  let position = 0;
  let velocity = 0;
  let written = 0;
  let frame = 0;
  let previousTime = 0;

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    active = null;
    velocity = 0;
  };
  const tick = (time: number) => {
    if (!active?.isConnected || motion.matches || Math.abs(active.scrollTop - written) > 1) {
      stop();
      return;
    }
    target = Math.max(0, Math.min(target, active.scrollHeight - active.clientHeight));
    // Do not turn a delayed/background frame into one large catch-up jump.
    const elapsed = Math.min(32, Math.max(1, time - previousTime));
    previousTime = time;
    // A critically damped spring starts gently and retains velocity when the
    // next wheel notch extends the target. Keep logical subpixel position:
    // reading the rounded DOM offset back into the motion loses tiny steps.
    const smoothingTime = 90;
    const displacement = position - target;
    const coefficient = velocity + displacement / smoothingTime;
    const decay = Math.exp(-elapsed / smoothingTime);
    const next = target + (displacement + coefficient * elapsed) * decay;
    const nextVelocity = (velocity - (coefficient * elapsed) / smoothingTime) * decay;
    const maximumStep = Math.min(8, elapsed * 0.48);
    const step = Math.max(-maximumStep, Math.min(maximumStep, next - position));
    position = Math.max(
      Math.min(position, target),
      Math.min(Math.max(position, target), position + step),
    );
    velocity = Math.max(-0.48, Math.min(0.48, nextVelocity));
    if (Math.abs(target - position) < 0.25 && Math.abs(velocity) < 0.01) {
      active.scrollTo({ top: target, behavior: "instant" });
      stop();
    } else {
      active.scrollTo({ top: position, behavior: "instant" });
      written = active.scrollTop;
      frame = requestAnimationFrame(tick);
    }
  };

  const wheel = (event: WheelEvent) => {
    const origin = event.target instanceof Element ? event.target : null;
    // Smooth every vertical wheel delta: small events must not cancel an
    // ongoing gesture or escape into native stepped scrolling.
    if (
      event.defaultPrevented ||
      !event.cancelable ||
      motion.matches ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !Number.isFinite(event.deltaY) ||
      !Number.isFinite(event.deltaX) ||
      !event.deltaY ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
      origin?.closest(
        '[data-board-area], cg-board, .cg-wrap, input, select, [contenteditable]:not([contenteditable="false"])',
      )
    ) {
      stop();
      return;
    }
    // Navigation/restoration can change the offset between wheel events and
    // the next paint. Start this input from the new offset immediately.
    if (active && Math.abs(active.scrollTop - written) > 1) stop();
    // SVG paths/icons are Elements, but not HTMLElements. Walk past them to
    // their HTML scroll parent rather than dropping the entire gesture.
    for (let panel = origin; panel; panel = panel.parentElement) {
      if (!(panel instanceof HTMLElement)) continue;
      const style = getComputedStyle(panel);
      const maximum = panel.scrollHeight - panel.clientHeight;
      // The viewport scrolls with the default visible overflow too. Explicit
      // hidden/clip roots still stay disabled, as in the fixed app shell.
      const scrollable =
        /^(auto|scroll|overlay)$/.test(style.overflowY) ||
        (panel === document.scrollingElement && style.overflowY === "visible");
      if (!scrollable || maximum <= 1) continue;
      const base = active === panel ? target : panel.scrollTop;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? parseFloat(style.lineHeight) || 16
          : event.deltaMode === 2
            ? panel.clientHeight
            : 1);
      const next = Math.max(0, Math.min(maximum, base + delta));
      if (next === base) {
        // Finish the current animation without leaking this gesture into a parent.
        if (active === panel) {
          event.preventDefault();
          return;
        }
        if (/^(contain|none)$/.test(style.overscrollBehaviorY)) return;
        continue;
      }
      event.preventDefault();
      const reversing = active === panel && Math.sign(delta) !== Math.sign(target - position);
      if (active !== panel) {
        stop();
        active = panel;
        position = written = panel.scrollTop;
      }
      // A reversal should respond immediately instead of first exhausting queued motion.
      if (reversing) velocity = 0;
      target = reversing ? Math.max(0, Math.min(maximum, position + delta)) : next;
      if (!frame) {
        previousTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
      return;
    }
  };
  document.addEventListener("wheel", wheel, { passive: false });
  document.addEventListener("pointerdown", stop, true);
  document.addEventListener("keydown", stop, true);
  const modernMotion = typeof motion.addEventListener === "function";
  if (modernMotion) motion.addEventListener("change", stop);
  else motion.addListener?.(stop);
  return () => {
    stop();
    document.removeEventListener("wheel", wheel);
    document.removeEventListener("pointerdown", stop, true);
    document.removeEventListener("keydown", stop, true);
    if (modernMotion) motion.removeEventListener("change", stop);
    else motion.removeListener?.(stop);
  };
}
