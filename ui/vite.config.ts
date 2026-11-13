/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build conventions: collision-safe "@assets" directory with CONTENT-HASHED
// file names, so the SPA handler (portal.go) can serve /@assets/* with an
// immutable one-year cache while index.html itself is never cached. The
// version query on the favicon (public/, not hashed) busts its cache.
// The unit tests format/expand dates in the local timezone. Pin it to the
// portal's audience unless a run sets TZ explicitly (e.g. to check other
// offsets: `TZ=America/New_York npm test`).
process.env.TZ = process.env.TZ || "Europe/Berlin";

export default defineConfig({
    plugins: [
        react(),
        {
            name: "asset-version-query",
            transformIndexHtml(html) {
                const timestamp = Date.now();
                return html
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
                entryFileNames: "@assets/[name]-[hash].js",
                chunkFileNames: "@assets/[name]-[hash].js",
                assetFileNames: "@assets/[name]-[hash][extname]",
            },
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.{test,spec}.ts"],
    },
});
