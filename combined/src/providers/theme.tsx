"use client";

import { ThemeProvider } from "@teispace/next-themes";

export function Theme({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="class" value={{ light: "light-mode", dark: "dark-mode" }} enableSystem>
            {children}
        </ThemeProvider>
    );
}
