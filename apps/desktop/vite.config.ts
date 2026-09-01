import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import path from "path";
import electron from "vite-plugin-electron/simple";
import { defineConfig, type Plugin } from "vite";
import { desktopContentSecurityPolicy } from "./electron/content-security-policy";

const shared = path.resolve(__dirname, "../../shared/src");
const desktopPackage = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version: string };

function contentSecurityPolicyPlugin(): Plugin {
    return {
        name: "coretex-content-security-policy",
        transformIndexHtml: {
            order: "pre",
            handler(_html, context) {
                return [{
                    tag: "meta",
                    attrs: {
                        "http-equiv": "Content-Security-Policy",
                        content: desktopContentSecurityPolicy(Boolean(context.server)),
                    },
                    injectTo: "head-prepend",
                }];
            },
        },
    };
}

export default defineConfig({
    // Electron production loads index.html over file://, so asset URLs must be
    // relative to the document instead of rooted at an HTTP origin.
    base: "./",
    // The desktop package version is the release source of truth. Shared UI reads
    // this compile-time constant so the About page always matches app.getVersion().
    define: {
        __CORETEX_VERSION__: JSON.stringify(desktopPackage.version),
    },
    plugins: [
        contentSecurityPolicyPlugin(),
        react(),
        tailwindcss(),
        electron({
            main: {
                entry: "electron/main.ts",
                // The Brain is already a compiled workspace package. Keeping
                // it external prevents Rolldown from trying to parse native
                // ssh2/node-pty addons as JavaScript.
                vite: {
                    build: {
                        rolldownOptions: { external: ["@repo/coretex/orchestrator"] },
                    },
                },
            },
            preload: {
                input: "electron/preload.ts",
                // vite-plugin-electron emits CommonJS preload code. Because
                // this package is ESM, the file must use a .cjs suffix or
                // Electron evaluates `require` in ESM scope and rejects it.
                vite: {
                    build: {
                        rolldownOptions: {
                            output: {
                                format: "cjs",
                                codeSplitting: false,
                                entryFileNames: "[name].cjs",
                                chunkFileNames: "[name].cjs",
                            },
                        },
                    },
                },
            },
            renderer: {},
        }),
    ],
    resolve: {
        alias: [
            // Ported LifeOS pages use Next.js App Router APIs; shim them for the Electron app.
            { find: "next/navigation", replacement: path.join(shared, "coretex/shims/next-navigation.ts") },
            { find: /^@\/components(.*)/, replacement: path.join(shared, "components$1") },
            { find: /^@\/hooks(.*)/, replacement: path.join(shared, "hooks$1") },
            { find: /^@\/utils(.*)/, replacement: path.join(shared, "utils$1") },
            { find: /^@\/lib(.*)/, replacement: path.join(shared, "lib$1") },
            { find: /^@\/coretex(.*)/, replacement: path.join(shared, "coretex$1") },
            { find: "@", replacement: path.resolve(__dirname, "./src") },
        ],
    },
});
