// @ts-nocheck
"use client";

// Coretex — AI status primitives in Untitled UI / brand-RED style.
//
//   <AiLoader />        — a "Generating…" loader: a brand-RED glowing orb that
//                         pulses + an orbiting ring, with the word shimmering
//                         beside it. Small + inline-friendly (sits in a chat row).
//   <ShiningText text>  — a gradient sweep shimmer over text for "Thinking…"
//                         states. Brand-tinted, motion-driven.
//
// Adapted from the pasted 21st.dev ai-loader / shining-text ideas — recreated in
// the LOOK only (brand tokens, no purple #471eec hardcodes, motion + CSS keyframes,
// gated by prefers-reduced-motion via the shared keyframe block).

import { useLayoutEffect } from "react";
import { motion } from "motion/react";
import { cx } from "@/utils/cx";

const STYLE_ID = "coretex-ai-loader-anim";
function ensureStyle() {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = `
@keyframes coretex-ai-orb-pulse {
  0%, 100% { transform: scale(0.82); opacity: 0.65; }
  50% { transform: scale(1.06); opacity: 1; }
}
@keyframes coretex-ai-orb-spin { to { transform: rotate(360deg); } }
@keyframes coretex-ai-text-shimmer { to { background-position: -200% center; } }
@media (prefers-reduced-motion: reduce) {
  .coretex-ai-orb-core,
  .coretex-ai-orb-ring { animation: none !important; }
  .coretex-ai-shimmer { animation: none !important; }
}`;
    document.head.appendChild(el);
}

const SIZES = {
    sm: { box: 14, text: "text-xs" },
    md: { box: 18, text: "text-sm" },
} as const;

interface AiLoaderProps {
    /** Word shown next to the orb (default "Generating"). A trailing "…" is added. */
    label?: string;
    size?: keyof typeof SIZES;
    className?: string;
    /** Hide the text and show only the orb. */
    orbOnly?: boolean;
}

/** Inline "Generating…" loader: a brand-RED glowing orb + shimmering word. */
export const AiLoader = ({ label = "Generating", size = "md", className, orbOnly }: AiLoaderProps) => {
    useLayoutEffect(() => {
        ensureStyle();
    }, []);
    const s = SIZES[size];

    return (
        <span className={cx("inline-flex items-center gap-2 align-middle", className)} role="status" aria-label={`${label}…`}>
            <span className="relative inline-block shrink-0" style={{ width: s.box, height: s.box }}>
                {/* soft brand glow */}
                <span
                    aria-hidden
                    className="absolute inset-0 rounded-full blur-[3px]"
                    style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--brand) 70%, transparent), transparent 70%)" }}
                />
                {/* pulsing core */}
                <span
                    aria-hidden
                    className="coretex-ai-orb-core absolute inset-0 rounded-full"
                    style={{
                        background: "radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--brand) 40%, #fff), var(--brand) 65%)",
                        boxShadow: "0 0 8px color-mix(in srgb, var(--brand) 65%, transparent)",
                        animation: "coretex-ai-orb-pulse 1.4s ease-in-out infinite",
                    }}
                />
                {/* orbiting ring */}
                <span
                    aria-hidden
                    className="coretex-ai-orb-ring absolute rounded-full"
                    style={{
                        inset: -2,
                        border: "1.5px solid transparent",
                        borderTopColor: "var(--brand)",
                        borderRightColor: "color-mix(in srgb, var(--brand) 40%, transparent)",
                        animation: "coretex-ai-orb-spin 0.9s linear infinite",
                    }}
                />
            </span>
            {!orbOnly && <ShiningText text={`${label}…`} className={s.text} />}
        </span>
    );
};

interface ShiningTextProps {
    text: string;
    className?: string;
}

/**
 * Brand-tinted shimmer: a light gradient sweeps left→right over muted text.
 * Use for "Thinking…" / streaming-pending states.
 */
export const ShiningText = ({ text, className }: ShiningTextProps) => {
    useLayoutEffect(() => {
        ensureStyle();
    }, []);

    return (
        <motion.span
            className={cx("coretex-ai-shimmer bg-clip-text font-medium text-transparent", className)}
            style={{
                backgroundImage:
                    "linear-gradient(90deg, var(--c-text-muted) 0%, var(--c-text-muted) 35%, color-mix(in srgb, var(--brand) 90%, #fff) 50%, var(--c-text-muted) 65%, var(--c-text-muted) 100%)",
                backgroundSize: "200% auto",
                backgroundPosition: "200% center",
                WebkitBackgroundClip: "text",
                animation: "coretex-ai-text-shimmer 2.4s linear infinite",
            }}
        >
            {text}
        </motion.span>
    );
};
