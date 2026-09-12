import { afterEach, expect, it, vi } from "vitest";
import { resolvePrivateServiceUrl } from "../serverUrl";
afterEach(() => vi.unstubAllEnvs());
it("private phone builds follow the opened host instead of a stale PC hostname", () => {
  vi.stubEnv("VITE_EN_CROISSANT_HOME_BUILD", "1");
  expect(resolvePrivateServiceUrl("https://old-pc.invalid")).toBe(window.location.origin);
});
it("public phone builds preserve their configured remote PC endpoint", () => {
  vi.stubEnv("VITE_EN_CROISSANT_HOME_BUILD", "");
  expect(resolvePrivateServiceUrl(" https://private-pc.example ")).toBe("https://private-pc.example");
  expect(resolvePrivateServiceUrl(undefined)).toBe("");
});
