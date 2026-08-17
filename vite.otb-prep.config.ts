import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
    ssr: {
        noExternal: true,
    },
    resolve: {
        alias: [{ find: "@", replacement: resolve(__dirname, "./src") }],
    },
    build: {
        target: "node22",
        ssr: true,
        outDir: "scripts/generated",
        emptyOutDir: false,
        lib: {
            entry: resolve(__dirname, "scripts/otb-prep-database.ts"),
            formats: ["es"],
            fileName: () => "otb-prep-database.js",
        },
        rollupOptions: {
            external: [/^node:/],
        },
    },
});
