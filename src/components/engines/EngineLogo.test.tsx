import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EngineLogo, type EngineLogoProfile } from "./EngineLogo";

const fixture = vi.hoisted(() => ({ convert: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: fixture.convert }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  fixture.convert.mockReset().mockImplementation((path) => `asset://fixture/${path}`);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(engine: EngineLogoProfile) {
  await act(async () =>
    root.render(
      <MantineProvider>
        <EngineLogo engine={engine} />
      </MantineProvider>,
    ),
  );
}
function image() {
  return host.querySelector("img");
}
async function fail(element: HTMLImageElement) {
  await act(async () => element.dispatchEvent(new Event("error")));
}

it("shows the bundled Stockfish mark without a custom or remote image", async () => {
  await render({ id: "stockfish", name: "Stockfish 19", type: "local" });
  expect(image()?.src).toMatch(/^data:image\/png/);
  expect(fixture.convert).not.toHaveBeenCalled();
});
it("recovers a failed custom image to the bundled mark", async () => {
  await render({ name: "Stockfish 19", image: "https://fixture.invalid/custom.png" });
  expect(image()?.src).toBe("https://fixture.invalid/custom.png");
  await fail(image()!);
  expect(image()?.src).toMatch(/^data:image\/png/);
});
it("uses a custom data URL directly", async () => {
  const src = "data:image/png;base64,AA==";
  await render({ name: "Owner engine", image: src });
  expect(image()?.src).toBe(src);
  expect(fixture.convert).not.toHaveBeenCalled();
});

it("uses a local custom image before the official mark", async () => {
  await render({ name: "Stockfish 19", image: "C:/Fixture/logo.png" });
  expect(fixture.convert).toHaveBeenCalledWith("C:/Fixture/logo.png");
  expect(image()?.src).toBe("asset://fixture/C:/Fixture/logo.png");
  await fail(image()!);
  expect(image()?.src).toMatch(/^data:image\/png/);
});
it("recovers native image lookup errors without an unhandled rejection", async () => {
  fixture.convert.mockRejectedValue(new Error("Invented missing file"));
  await render({ name: "LCZero", image: "C:/Fixture/missing.png" });
  expect(image()?.src).toMatch(/^data:image\/png/);
});
it("uses a generic icon if both the custom and bundled mark fail", async () => {
  await render({ name: "Stockfish 19", image: "https://fixture.invalid/broken.png" });
  await fail(image()!);
  await fail(image()!);
  expect(image()).toBeNull();
  expect(host.querySelector('[data-engine-logo-fallback="cpu"]')).not.toBeNull();
});
it("cannot apply a delayed local-image result or error to another profile", async () => {
  let resolve!: (value: string) => void;
  fixture.convert.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  await render({ id: "old", name: "LCZero", image: "C:/Fixture/slow.png" });
  const old = image()!;
  await render({ id: "new", name: "Stockfish 19" });
  const current = image()!.src;
  expect(current).not.toBe(old.src);
  await act(async () => resolve("asset://fixture/old-image.png"));
  await fail(old);
  expect(image()?.src).toBe(current);
});
it("tries a replacement custom image after the previous one fails", async () => {
  await render({ id: "owner", name: "Stockfish 19", image: "https://fixture.invalid/old.png" });
  await fail(image()!);
  await render({ id: "owner", name: "Stockfish 19", image: "https://fixture.invalid/new.png" });
  expect(image()?.src).toBe("https://fixture.invalid/new.png");
});
it("retries a failed custom image after navigating away and back", async () => {
  const profile = { id: "owner", name: "Stockfish 19", image: "https://fixture.invalid/retry.png" };
  await render(profile);
  await fail(image()!);
  await act(async () => root.render(null));
  await render(profile);
  expect(image()?.src).toBe(profile.image);
});
it("keeps generic engine and cloud service icons for unknown identities", async () => {
  await render({ name: "Fairy-Stockfish", path: "C:/Fixture/fairy-stockfish.exe", type: "local" });
  expect(image()).toBeNull();
  expect(host.querySelector('[data-engine-logo-fallback="cpu"]')).not.toBeNull();
  await render({ name: "Stockfish tablebase", type: "chessdb" });
  expect(image()).toBeNull();
  expect(host.querySelector('[data-engine-logo-fallback="cloud"]')).not.toBeNull();
});
it("recognizes the native executable when the owner uses a custom label", async () => {
  await render({ name: "Owner analysis", path: "C:\\Fixture\\stockfish_19.exe", type: "local" });
  expect(image()?.src).toMatch(/^data:image\/png/);
});
it("uses the configured PC engine identity while preserving its custom label", async () => {
  await render({ name: "Owner PC engine", type: "pc", engineKind: "lc0" });
  expect(image()?.src).toMatch(/^data:image\/png/);
  expect(fixture.convert).not.toHaveBeenCalled();
});
