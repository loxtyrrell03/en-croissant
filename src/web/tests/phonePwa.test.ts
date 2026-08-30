import { describe, expect, test } from "vitest";
import html from "../../../index.html?raw";
import manifestText from "../../../public/manifest.webmanifest?raw";

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
    });
});
