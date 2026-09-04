import { resolve } from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
    publicDir: false,
    ssr: { noExternal: true },
    resolve: { alias: [{ find: "@", replacement: resolve(__dirname, "src") }] },
    build: {
        target: "node22",
        ssr: true,
        outDir: "scripts/generated",
        emptyOutDir: false,
        lib: {
            entry: resolve(__dirname, "scripts/shared-review-service.ts"),
            formats: ["es"],
            fileName: () => "shared-review-service.js",
        },
        rollupOptions: { external: [/^node:/] },
    },
});
