import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(__dirname, "../../shared/src");

const aliasMap = {
    "@/components": path.join(shared, "components"),
    "@/hooks":      path.join(shared, "hooks"),
    "@/utils":      path.join(shared, "utils"),
    "@/lib":        path.join(shared, "lib"),
    "@/coretex":    path.join(shared, "coretex"),
};

/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        optimizePackageImports: ["@untitledui/icons"],
        externalDir: true,
    },
    // jspdf's fflate dependency uses a dynamic `new Worker(...)` path neither
    // bundler can statically resolve for the Node/SSR target. It's a
    // browser-only PDF export (dynamically imported on click), so keep it out
    // of the server bundle entirely — this option works for both Turbopack
    // and webpack, unlike the webpack-only `config.externals` array.
    serverExternalPackages: ["jspdf", "jspdf-autotable"],
    webpack(config) {
        config.resolve.alias = {
            ...config.resolve.alias,
            ...aliasMap,
        };
        return config;
    },
};

export default nextConfig;
