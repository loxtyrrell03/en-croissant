type CloseActions = {
  deferForCoach: () => boolean;
  hide: () => Promise<void>;
  minimize: () => Promise<void>;
  exit: () => Promise<void>;
};

export async function closeApplication(actions: CloseActions): Promise<void> {
  if (actions.deferForCoach()) {
    // Older running binaries lack allow-hide; keep their coach work alive too.
    try {
      await actions.hide();
    } catch {
      await actions.minimize();
    }
    return;
  }
  await actions.exit();
}

export function handleCloseRequest(
  event: { preventDefault: () => void },
  close: () => Promise<void>,
): Promise<void> {
  // Tauri's default listener calls destroy(), which requires a separate ACL.
  event.preventDefault();
  return close();
}
