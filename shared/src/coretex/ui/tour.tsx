// @ts-nocheck
"use client";

// Coretex — first-run welcome tour. An INTERACTIVE spotlight walkthrough: it
// navigates around the app, dims the viewport with a cutout over the real element
// for the current step, and floats a coachmark beside it with progress + controls.
// Shown once on first run (persisted via localStorage) and re-openable from the
// account menu / Settings → About / Home hero. Untitled UI styled; red core brand.
//
// Mechanics:
//   - Each Step may carry a `nav` (a NavTarget routed via props.onNavigate) and a
//     `target` (a data-tour="<key>" attribute on a real element). Before showing a
//     step we navigate, then poll for the element (~1.5s), scroll it into view, and
//     place a spotlight + coachmark. No target → a centered card (welcome / finish).
//   - The cutout is a transparent rounded "hole": a fixed div sized to the element's
//     rect with a huge box-shadow scrim + a brand ring + soft brand glow. It springs
//     between steps (instant under prefers-reduced-motion).
//   - Coachmark auto-flips/clamps on-screen (mirrors ui/anchored-popover logic).
//   - Keyboard: →/Enter next, ← back, Esc skip. Finish/Skip → onClose() + markTourSeen().

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
    ArrowLeft, ArrowRight, X, Home01, Users01, Stars01, SearchMd,
    Signal01, Columns03, Rocket01, Settings01, LayoutAlt01,
} from "@untitledui/icons";
import type { FC } from "react";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";
import type { NavTarget } from "../nav";

const SEEN_KEY = "coretex-tour-seen";

export function tourSeen(): boolean {
    try {
        return typeof window !== "undefined" && window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
        return true;
    }
}
export function markTourSeen(): void {
    try {
        window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
        /* ignore */
    }
}

/** Open the tour from anywhere (e.g. Settings → About) without prop threading. */
export const TOUR_EVENT = "coretex:open-tour";
export function requestTour(): void {
    try {
        window.dispatchEvent(new Event(TOUR_EVENT));
    } catch {
        /* ignore */
    }
}

type IconCmp = FC<{ className?: string; style?: React.CSSProperties }>;

interface Step {
    icon: IconCmp;
    color: "brand" | "gray" | "success" | "warning" | "error";
    title: string;
    body: string;
    /** Navigate here before showing the step (routed via props.onNavigate). */
    nav?: NavTarget;
    /** A data-tour="<key>" attribute to spotlight. Omit for a centered card. */
    target?: string;
}

const STEPS: Step[] = [
    {
        icon: Rocket01, color: "brand",
        title: "Welcome to Coretex",
        body: "Your local AI agent workspace — deploy agents, plan and run work, manage projects, terminals, servers, and keys, all from one cockpit. Here's a 60-second tour.",
    },
    {
        icon: LayoutAlt01, color: "brand",
        target: "sidebar-brand",
        title: "Navigation",
        body: "The sidebar is your map. Sections group everything: Overview, Workspace, Projects, Infrastructure, and your secrets. Jump anywhere from here.",
    },
    {
        icon: Home01, color: "brand",
        nav: { kind: "home" }, target: "nav-home",
        title: "The Home cockpit",
        body: "A live view across everything: active agents, tasks today, spend vs. budget, providers, and a customizable task board.",
    },
    {
        icon: Users01, color: "success",
        nav: { kind: "agents" }, target: "nav-agents",
        title: "Agents",
        body: "Deploy one or many agents, then stop / pause / resume them — globally or per project. Each shows its live task, step, and accruing cost.",
    },
    {
        icon: Stars01, color: "brand",
        nav: { kind: "aichat" }, target: "nav-aichat",
        title: "AI Chat",
        body: "Talk to your models directly — scoped to a project and agent. Stream answers, attach context, and hand work straight to the fleet.",
    },
    {
        icon: Columns03, color: "gray",
        nav: { kind: "files" }, target: "split-view",
        title: "Infrastructure & split view",
        body: "Files, Database, Docker, Remote, and Running servers. These infra areas can open side-by-side — use Split view to compare two panes at once.",
    },
    {
        icon: SearchMd, color: "brand",
        target: "omni-bar",
        title: "Ask AI & search",
        body: "The bottom-center bar searches everything and runs commands. Press Ctrl+K from anywhere to summon it, or Ask AI to chat in-context.",
    },
    {
        icon: Signal01, color: "warning",
        target: "status-cluster",
        title: "Live activity",
        body: "Bottom-right keeps an eye on the action: running terminals, active agents (with their consoles), and alerts as they fire.",
    },
    {
        icon: Settings01, color: "brand",
        title: "You're all set",
        body: "That's the cockpit. Open Settings to customize appearance, providers, keybinds, and more. You can replay this tour anytime from the account menu.",
    },
];

const PAD = 12; // viewport padding kept around the coachmark
const GAP = 14; // gap between the spotlight and the coachmark
const COACH_W = 360; // coachmark width used for clamp math (matches the rendered width)
const RING = 6; // spotlight padding around the target rect

interface Rect {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** Route to a NavTarget before a step that carries `nav` (wire to setNav). */
    onNavigate?: (target: NavTarget) => void;
}

/** Poll for an element by data-tour key for up to `timeout` ms (rAF-driven). */
function waitForTarget(key: string, timeout: number): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
        if (typeof document === "undefined") return resolve(null);
        const sel = `[data-tour="${key}"]`;
        const found = document.querySelector<HTMLElement>(sel);
        if (found) return resolve(found);
        const start = performance.now();
        const tick = () => {
            const el = document.querySelector<HTMLElement>(sel);
            if (el) return resolve(el);
            if (performance.now() - start >= timeout) return resolve(null);
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

export const CoretexTour = ({ isOpen, onClose, onNavigate }: Props) => {
    const reduceMotion = useReducedMotion();
    const [i, setI] = useState(0);
    // The measured spotlight rect for the current step, or null = centered card.
    const [rect, setRect] = useState<Rect | null>(null);
    // Bumped to force a re-measure (after navigation / on scroll / resize).
    const [measureSeq, setMeasureSeq] = useState(0);
    // The element we're currently tracking (re-measured on scroll/resize).
    const targetElRef = useRef<HTMLElement | null>(null);
    const coachRef = useRef<HTMLDivElement | null>(null);
    // Coachmark position (null until measured → kept off-screen to avoid a flash).
    const [coachPos, setCoachPos] = useState<{ left: number; top: number; place: "top" | "bottom" | "center" } | null>(null);

    const step = STEPS[i];
    const isLast = i === STEPS.length - 1;

    const finish = useCallback(() => {
        markTourSeen();
        setI(0);
        setRect(null);
        targetElRef.current = null;
        onClose();
    }, [onClose]);

    // Reset to the first step every time the tour (re)opens.
    useEffect(() => {
        if (isOpen) {
            setI(0);
            setRect(null);
            targetElRef.current = null;
            setCoachPos(null);
        }
    }, [isOpen]);

    // Drive each step: navigate (if asked), then resolve + spotlight the target.
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        targetElRef.current = null;

        const run = async () => {
            if (step.nav) onNavigate?.(step.nav);
            if (!step.target) {
                // Centered card (welcome / finish) — no cutout.
                if (!cancelled) {
                    setRect(null);
                    targetElRef.current = null;
                    setMeasureSeq((n) => n + 1);
                }
                return;
            }
            // Give navigation a beat to render, then poll for the element.
            const el = await waitForTarget(step.target, 1500);
            if (cancelled) return;
            if (el) {
                el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
                targetElRef.current = el;
                // Allow the scroll to settle before the first measure.
                requestAnimationFrame(() => {
                    if (!cancelled) setMeasureSeq((n) => n + 1);
                });
            } else {
                // Graceful fallback: centered card with no cutout.
                targetElRef.current = null;
                setRect(null);
                setMeasureSeq((n) => n + 1);
            }
        };
        run();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, i]);

    // Measure the tracked element → spotlight rect. Re-runs on scroll/resize.
    const measure = useCallback(() => {
        const el = targetElRef.current;
        if (!el) { setRect(null); return; }
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) { setRect(null); return; }
        setRect({
            top: Math.max(0, r.top - RING),
            left: Math.max(0, r.left - RING),
            width: r.width + RING * 2,
            height: r.height + RING * 2,
        });
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) return;
        measure();
        const onScroll = () => measure();
        const onResize = () => measure();
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onResize);
        };
    }, [isOpen, measureSeq, measure]);

    // Place the coachmark relative to the spotlight (flip/clamp), or center it.
    useLayoutEffect(() => {
        if (!isOpen) return;
        if (typeof window === "undefined") return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const panel = coachRef.current;
        const h = panel?.offsetHeight ?? 200;
        const w = Math.min(COACH_W, vw - PAD * 2);

        if (!rect) {
            setCoachPos({ left: (vw - w) / 2, top: Math.max(PAD, (vh - h) / 2), place: "center" });
            return;
        }
        // Prefer below the spotlight, flip above when it would overflow the bottom.
        const spaceBelow = vh - (rect.top + rect.height) - GAP - PAD;
        const spaceAbove = rect.top - GAP - PAD;
        let place: "top" | "bottom" = "bottom";
        let top = rect.top + rect.height + GAP;
        if (h > spaceBelow && spaceAbove > spaceBelow) {
            place = "top";
            top = rect.top - GAP - h;
        }
        // Center horizontally on the spotlight, then clamp on-screen.
        let left = rect.left + rect.width / 2 - w / 2;
        if (left + w > vw - PAD) left = vw - PAD - w;
        if (left < PAD) left = PAD;
        top = Math.min(Math.max(PAD, top), Math.max(PAD, vh - h - PAD));
        setCoachPos({ left, top, place });
    }, [isOpen, rect, i, measureSeq]);

    // Keyboard: →/Enter next, ← back, Esc skip.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); }
            else if (e.key === "ArrowRight" || e.key === "Enter") {
                e.preventDefault();
                setI((n) => (n >= STEPS.length - 1 ? n : n + 1));
                if (i >= STEPS.length - 1) finish();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                setI((n) => Math.max(0, n - 1));
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [isOpen, i, finish]);

    if (!isOpen || typeof document === "undefined") return null;

    const Icon = step.icon;
    const next = () => (isLast ? finish() : setI((n) => n + 1));
    const back = () => setI((n) => Math.max(0, n - 1));

    const spring = reduceMotion
        ? { duration: 0 }
        : { type: "spring" as const, stiffness: 320, damping: 32, mass: 0.8 };

    return createPortal(
        <div className="fixed inset-0 z-[80]" aria-live="polite" role="dialog" aria-modal="true" aria-label="Coretex product tour">
            {rect ? (
                // ---- Spotlight cutout: a transparent rounded hole punched in a scrim ----
                <motion.div
                    className="pointer-events-auto fixed"
                    style={{ borderRadius: 12 }}
                    initial={false}
                    animate={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
                    transition={spring}
                    // Clicking the dim area does nothing meaningful; swallow it.
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div
                        className="absolute inset-0"
                        style={{
                            borderRadius: 12,
                            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55), 0 0 0 2px var(--brand), 0 0 22px 4px var(--brand-glow, color-mix(in srgb, var(--brand) 45%, transparent))",
                        }}
                    />
                </motion.div>
            ) : (
                // ---- Plain dim scrim for centered cards ----
                <div
                    className="fixed inset-0"
                    style={{ background: "rgba(0,0,0,0.55)" }}
                    onMouseDown={(e) => e.stopPropagation()}
                />
            )}

            {/* ---- Coachmark ---- */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={i}
                    ref={coachRef}
                    className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-2xl shadow-2xl"
                    style={{
                        left: coachPos?.left ?? -9999,
                        top: coachPos?.top ?? -9999,
                        width: `min(${COACH_W}px, calc(100vw - ${PAD * 2}px))`,
                        visibility: coachPos ? "visible" : "hidden",
                        background: "var(--glass-bg, var(--surface))",
                        border: "1px solid var(--glass-border, var(--c-border))",
                        backdropFilter: "blur(18px) saturate(140%)",
                        WebkitBackdropFilter: "blur(18px) saturate(140%)",
                    }}
                    initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 pt-3.5">
                        <div className="flex items-center gap-2">
                            <img src="./coretex-icon.svg" alt="" className="size-5" />
                            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-muted)" }}>
                                Tour · {i + 1} / {STEPS.length}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={finish}
                            aria-label="Skip tour"
                            className="rounded p-1 transition"
                            style={{ color: "var(--c-text-muted)" }}
                        >
                            <X className="size-4" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex items-start gap-3.5 px-4 pt-3 pb-1">
                        <FeaturedIcon icon={Icon} size="lg" color={step.color} theme="light" />
                        <div className="flex min-w-0 flex-col gap-1 pt-0.5">
                            <h2 className="text-md font-semibold" style={{ color: "var(--c-text-primary)" }}>{step.title}</h2>
                            <p className="text-sm" style={{ color: "var(--c-text-secondary)" }}>{step.body}</p>
                        </div>
                    </div>

                    {/* Progress dots */}
                    <div className="flex items-center justify-center gap-1.5 px-4 pt-3 pb-1">
                        {STEPS.map((_, idx) => (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => setI(idx)}
                                className={cx("h-1.5 rounded-full transition-all", idx === i ? "w-5" : "w-1.5")}
                                style={{ background: idx === i ? "var(--brand)" : "var(--c-border)" }}
                                aria-label={`Go to step ${idx + 1}`}
                                aria-current={idx === i}
                            />
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="mt-2 flex items-center justify-between gap-2 border-t px-4 py-3" style={{ borderColor: "var(--glass-border, var(--c-border))" }}>
                        <Button size="sm" color="link-gray" onClick={finish}>Skip tour</Button>
                        <div className="flex items-center gap-2">
                            {i > 0 && <Button size="sm" color="secondary" iconLeading={ArrowLeft} onClick={back}>Back</Button>}
                            {isLast ? (
                                <Button size="sm" color="primary" iconLeading={Rocket01} onClick={finish}>Done</Button>
                            ) : (
                                <Button size="sm" color="primary" iconTrailing={ArrowRight} onClick={next}>Next</Button>
                            )}
                        </div>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>,
        document.body,
    );
};
