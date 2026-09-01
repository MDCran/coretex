// @ts-nocheck
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/utils/cx";

/**
 * Subtle scroll-into-view entrance: fades + lifts content on first reveal. Honors
 * prefers-reduced-motion (shows instantly) and only animates once. Tasteful, not flashy.
 */
export function Reveal({ children, className, delayMs = 0 }: { children: ReactNode; className?: string; delayMs?: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
            setShown(true);
            return;
        }
        const io = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setShown(true);
                    io.disconnect();
                }
            },
            { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            style={shown ? { transitionDelay: `${delayMs}ms` } : undefined}
            className={cx(
                "transition-all duration-500 ease-out will-change-[opacity,transform] motion-reduce:transition-none",
                shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100",
                className,
            )}
        >
            {children}
        </div>
    );
}
