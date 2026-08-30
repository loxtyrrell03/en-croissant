import { describe, expect, test } from "vitest";
import html from "../../../index.html?raw";
import manifestText from "../../../public/manifest.webmanifest?raw";
import serviceWorkerText from "../../../public/web-sw.js?raw";
import { webBuildIsStale } from "../webAppLifecycle";

describe("phone standalone app shell", () => {
    test("declares a root-scoped standalone PWA for Home Screen launches", () => {
        const manifest = JSON.parse(manifestText) as Record<string, unknown>;

        expect(manifest).toMatchObject({
            id: "/",
            start_url: "/",
            scope: "/",
            display: "standalone",
        });
    });

    test("enables the iPhone standalone launch mode", () => {
        expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
        expect(html).toContain('name="apple-mobile-web-app-title" content="En Croissant"');
        expect(html).toContain('rel="apple-touch-icon" href="/logo.png"');
        expect(html).toContain('name="en-croissant-build" content="__EN_CROISSANT_BUILD_ID__"');
    });

    test("activates new builds without navigating a suspended phone window", () => {
        expect(serviceWorkerText).not.toContain("client.navigate");
        expect(serviceWorkerText).not.toContain("skipWaiting");
        expect(serviceWorkerText).toContain("key.startsWith(CACHE_PREFIX)");
        expect(serviceWorkerText).toContain('type: "EN_CROISSANT_SW_ACTIVATED"');
        expect(serviceWorkerText).toContain('url.pathname.endsWith("/app-version.json")');
    });

    test("reloads only when a stamped document is older than the deployment", () => {
        expect(webBuildIsStale("old", "new")).toBe(true);
        expect(webBuildIsStale("current", "current")).toBe(false);
        expect(webBuildIsStale(null, "current")).toBe(false);
        expect(webBuildIsStale("current", null)).toBe(false);
    });
});
