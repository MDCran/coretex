"use client";

import { useEffect, useState } from "react";
import { Moon01, Sun } from "@untitledui/icons";
import { useTheme } from "@teispace/next-themes";
import { cx } from "@/utils/cx";

/** Light/dark toggle. Mounted-guarded to avoid a hydration flash from next-themes. */
export function ThemeToggle({ className }: { className?: string }) {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const isDark = mounted && resolvedTheme === "dark";
    const label = mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle color theme";

    return (
        <button
            type="button"
            aria-label={label}
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className={cx(
                "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-quaternary outline-focus-ring transition duration-100 ease-linear hover:bg-primary_hover hover:text-fg-secondary focus-visible:outline-2 focus-visible:outline-offset-2",
                className,
            )}
        >
            {!mounted ? (
                <Sun className="size-5" aria-hidden="true" />
            ) : isDark ? (
                <Moon01 className="size-5" aria-hidden="true" />
            ) : (
                <Sun className="size-5" aria-hidden="true" />
            )}
        </button>
    );
}
