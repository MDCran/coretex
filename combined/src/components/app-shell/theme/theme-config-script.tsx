import { themeInitScript } from "@/lib/theme-init-script";

/**
 * Pre-hydration theme bootstrap as an inline <script> (matches the root layout). Not
 * next/script `beforeInteractive`, which throws React 19's "script tag while rendering
 * React component" error and shows a blocking dev overlay.
 */
export function ThemeConfigScript() {
    return <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />;
}
