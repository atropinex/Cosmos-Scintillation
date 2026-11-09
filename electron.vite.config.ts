import {resolve} from "path";
import react from "@vitejs/plugin-react";
import {defineConfig, externalizeDepsPlugin} from "electron-vite";

// The three entry points keep the names the window controller loads:
// out/main/mainindex.js, out/preload/preloadindex.js and out/renderer/index.html.
export default defineConfig({
    main: {
        // "yaml" is bundled into the main file, so the packaged app does not need node_modules.
        plugins: [externalizeDepsPlugin({exclude: ["yaml"]})],
        build: {
            rollupOptions: {input: {mainindex: resolve("scripts/ui/mainindex.ts")}}
        }
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {input: {preloadindex: resolve("scripts/preload/preloadindex.ts")}}
        }
    },
    renderer: {
        root: resolve("scripts/ui"),
        plugins: [react()],
        // styles.btnPrimary for .btn-primary
        css: {modules: {localsConvention: "camelCase"}},
        build: {
            // The page is split by view so a screen that is not open costs no memory.
            rollupOptions: {input: resolve("scripts/ui/index.html")}
        }
    }
});
