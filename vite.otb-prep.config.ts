import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [{
        name: "stable-dependency-region-comments",
        generateBundle(_options, bundle) {
            // Reusing the dependency junction must not change tracked output.
            for (const chunk of Object.values(bundle)) if (chunk.type === "chunk") {
                chunk.code = chunk.code.replace(/^(\/\/#region )(?:.*?\/)?(node_modules\/.*)$/gm, "$1$2");
            }
        },
    }],
    publicDir: false,
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
