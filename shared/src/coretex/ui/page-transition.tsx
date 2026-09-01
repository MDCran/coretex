// @ts-nocheck
"use client";

// Coretex — premium page enter/exit transitions. Soft fade + slight rise + light
// blur so view switches feel fluid without a harsh cut. Honors reduced-motion
// and the appearance.window.paneAnimations kill-switch (via caller).

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cx } from "@/utils/cx";

const EASE = [0.22, 1, 0.36, 1] as const;

export function PageTransition({
    pageKey,
    children,
    reduceMotion,
    className,
    /** Slightly longer, softer motion for settings sub-pages. */
    tone = "default",
}: {
    pageKey: string;
    children: ReactNode;
    reduceMotion?: boolean | null;
    className?: string;
    tone?: "default" | "soft";
}) {
    const duration = tone === "soft" ? 0.32 : 0.26;
    const yIn = tone === "soft" ? 12 : 8;
    const yOut = tone === "soft" ? -8 : -6;

    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={pageKey}
                initial={reduceMotion ? false : { opacity: 0, y: yIn, filter: "blur(5px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduceMotion ? undefined : { opacity: 0, y: yOut, filter: "blur(4px)" }}
                transition={{ duration, ease: EASE }}
                className={cx("h-full min-h-0 min-w-0 w-full", className)}
            >
                {children}
            </motion.div>
        </AnimatePresence>
    );
}
