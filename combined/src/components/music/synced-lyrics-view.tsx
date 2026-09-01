"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import { activeSyncedDisplayIndex, hasLyricText } from "@/lib/lrc";
import type { SyncedLyricLine } from "@/lib/genius-types";
import { cx } from "@/utils/cx";

interface Props {
    lines: SyncedLyricLine[];
    progressMs: number;
    isPlaying: boolean;
    /** Scroll container for lyrics — keeps auto-scroll inside this element only. */
    scrollRootRef?: RefObject<HTMLElement | null>;
}

function scrollIntoContainer(container: HTMLElement, target: HTMLElement, behavior: ScrollBehavior = "smooth") {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const delta = targetRect.top + targetRect.height / 2 - (containerRect.top + containerRect.height / 2);
    container.scrollBy({ top: delta, behavior });
}

const COMPACT_MAX_WIDTH_PX = 639;
const COMPACT_BEFORE = 1;
const COMPACT_AFTER = 2;

function subscribeCompact(cb: () => void) {
    const mq = window.matchMedia(`(max-width: ${COMPACT_MAX_WIDTH_PX}px)`);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
}

function getCompactSnapshot() {
    return window.matchMedia(`(max-width: ${COMPACT_MAX_WIDTH_PX}px)`).matches;
}

function useCompactLyricsLayout() {
    return useSyncExternalStore(subscribeCompact, getCompactSnapshot, () => false);
}

export function SyncedLyricsView({ lines, progressMs, isPlaying, scrollRootRef }: Props) {
    const displayIndex = useMemo(() => activeSyncedDisplayIndex(lines, progressMs), [lines, progressMs]);
    const isCompact = useCompactLyricsLayout();
    const activeRef = useRef<HTMLParagraphElement>(null);

    const visibleIndices = useMemo(() => {
        if (!isCompact || displayIndex < 0) {
            return lines.map((_, index) => index);
        }

        const start = Math.max(0, displayIndex - COMPACT_BEFORE);
        const end = Math.min(lines.length - 1, displayIndex + COMPACT_AFTER);
        return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
    }, [displayIndex, isCompact, lines]);

    useEffect(() => {
        if (!isPlaying || displayIndex < 0 || !activeRef.current) return;

        const container = scrollRootRef?.current;
        if (container) {
            scrollIntoContainer(container, activeRef.current);
            return;
        }

        activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth", inline: "nearest" });
    }, [displayIndex, isPlaying, scrollRootRef]);

    const showLeadingEllipsis = isCompact && visibleIndices[0] > 0;
    const showTrailingEllipsis = isCompact && visibleIndices[visibleIndices.length - 1] < lines.length - 1;

    return (
        <div
            className={cx(
                "flex flex-col py-1",
                isCompact ? "min-h-[10rem] justify-center gap-3 px-1 sm:min-h-0" : "gap-2",
            )}
            aria-live="polite"
            aria-atomic="false"
        >
            {showLeadingEllipsis && (
                <p className="text-center text-xs text-quaternary" aria-hidden="true">
                    ···
                </p>
            )}

            {visibleIndices.map((index) => {
                const line = lines[index];

                if (!hasLyricText(line)) {
                    return null;
                }

                const isActive = index === displayIndex;
                const isPast = displayIndex >= 0 && index < displayIndex;

                return (
                    <p
                        key={`${line.timeMs}-${index}`}
                        ref={isActive ? activeRef : undefined}
                        className={cx(
                            "whitespace-pre-wrap text-center font-sans leading-relaxed transition duration-150 ease-linear sm:text-left",
                            isCompact
                                ? isActive
                                    ? "text-xl font-semibold text-brand-secondary sm:text-lg"
                                    : isPast
                                      ? "text-sm text-tertiary opacity-70"
                                      : "text-sm text-secondary opacity-90"
                                : isActive
                                  ? "text-lg font-semibold text-brand-secondary"
                                  : isPast
                                    ? "text-sm text-tertiary opacity-60"
                                    : "text-sm text-secondary",
                        )}
                    >
                        {line.text}
                    </p>
                );
            })}

            {showTrailingEllipsis && (
                <p className="text-center text-xs text-quaternary" aria-hidden="true">
                    ···
                </p>
            )}
        </div>
    );
}
