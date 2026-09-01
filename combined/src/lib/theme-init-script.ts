import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Raw JS that bootstraps the saved accent color + density before first paint to
 * avoid a flash. Rendered as an inline `<script dangerouslySetInnerHTML>` in the
 * document <head> rather than `next/script` with `strategy="beforeInteractive"`:
 * under Next 16 + React 19 the `<Script>` component throws "Encountered a script
 * tag while rendering React component" and surfaces a dev error overlay that makes
 * the whole app (mobile nav included) look frozen. A plain external `<script src>`
 * is hoisted out of <body> by React 19 and breaks hydration, so inline-in-head is
 * the one form that both runs pre-paint and keeps hydration intact.
 *
 * Single source of truth lives in public/theme-init.js (also served statically).
 */
export const themeInitScript = readFileSync(join(process.cwd(), "public", "theme-init.js"), "utf8");
