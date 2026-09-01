"use client";

import { useTheme } from "@teispace/next-themes";
import { Toaster as SonnerToaster } from "sonner";

/** Sonner toaster that follows the app's light/dark theme. */
export function Toaster() {
    const { resolvedTheme } = useTheme();
    return <SonnerToaster richColors position="top-right" theme={resolvedTheme === "dark" ? "dark" : "light"} />;
}
