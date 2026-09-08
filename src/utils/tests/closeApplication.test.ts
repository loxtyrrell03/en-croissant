import { describe, expect, it, vi } from "vitest";
import { closeApplication, handleCloseRequest } from "../closeApplication";

function actions(defer = false) {
  return {
    deferForCoach: vi.fn(() => defer),
    hide: vi.fn(async () => {}),
    minimize: vi.fn(async () => {}),
    exit: vi.fn(async () => {}),
  };
}

describe("application close", () => {
  it("prevents Tauri's unauthorized default destroy before exiting", async () => {
    const calls: string[] = [];
    await handleCloseRequest(
      { preventDefault: () => { calls.push("prevent"); } },
      async () => { calls.push("exit"); },
    );
    expect(calls).toEqual(["prevent", "exit"]);
  });

  it("exits immediately when no coach work is pending", async () => {
    const api = actions();
    await closeApplication(api);
    expect(api.exit).toHaveBeenCalledOnce();
    expect(api.hide).not.toHaveBeenCalled();
  });

  it("hides while preserving pending coach work", async () => {
    const api = actions(true);
    await closeApplication(api);
    expect(api.hide).toHaveBeenCalledOnce();
    expect(api.exit).not.toHaveBeenCalled();
  });

  it("minimizes older binaries when hiding is denied without killing coach work", async () => {
    const api = actions(true);
    api.hide.mockRejectedValue(new Error("window.hide not allowed"));
    await closeApplication(api);
    expect(api.minimize).toHaveBeenCalledOnce();
    expect(api.exit).not.toHaveBeenCalled();
  });
});
