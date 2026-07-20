import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadSharedLichessCredential,
  saveSharedLichessCredential,
} from "../sharedLichessAuth";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared Lichess authentication", () => {
  it("loads the private PC credential without using browser-local state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        connected: true,
        token: "persistent-private-token",
        username: "test-player",
        updatedAt: 123,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadSharedLichessCredential()).resolves.toEqual({
      connected: true,
      token: "persistent-private-token",
      username: "test-player",
      updatedAt: 123,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://gaming-pc.tail89d19b.ts.net/api/lichess-credential",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
  });

  it("treats a missing shared credential as the one-time setup state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(loadSharedLichessCredential()).resolves.toBeNull();
  });

  it("persists a newly authorized token through the private PC service", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        connected: true,
        token: "new-persistent-private-token",
        username: "test-player",
        updatedAt: 456,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveSharedLichessCredential(" new-persistent-private-token ");

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ token: "new-persistent-private-token" }),
    });
  });
});
