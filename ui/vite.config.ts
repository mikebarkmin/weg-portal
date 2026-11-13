/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build conventions follow ../bugstage/ui/vite.config.js: collision-safe
// "@assets" directory with unhashed filenames + version query strings for
// cache busting (the SPA handler serves /@assets/* with no-store, so stale
// index.html references are the only risk; version queries fix that).
export default defineConfig({
    plugins: [
        react(),
        {
            name: "asset-version-query",
            transformIndexHtml(html) {
                const timestamp = Date.now();
                return html
                    .replaceAll('.js"', `.js?v=${timestamp}"`)
                    .replaceAll('.css"', `.css?v=${timestamp}"`)
                    .replaceAll('.svg"', `.svg?v=${timestamp}"`);
            },
        },
    ],
    build: {
        chunkSizeWarningLimit: 1000,
        reportCompressedSize: false,
        assetsDir: "@assets",
        rollupOptions: {
            output: {
                // unhashed so that a stale committed index.html never
                // references files that no longer exist after a rebuild
                entryFileNames: "@assets/[name].js",
                assetFileNames: "@assets/[name][extname]",
            },
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.{test,spec}.ts"],
    },
});
