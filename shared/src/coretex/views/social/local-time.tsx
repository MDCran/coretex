// @ts-nocheck

import { useEffect, useState } from "react";
import { Clock } from "@untitledui/icons";
import { cx } from "@/utils/cx";

/** Format the current time in a given IANA timezone, e.g. "3:42 PM". Returns null when invalid. */
function timeInZone(timezone: string): string | null {
    try {
        return new Intl.DateTimeFormat(undefined, {
            hour: "numeric",
            minute: "2-digit",
            timeZone: timezone,
        }).format(new Date());
    } catch {
        return null;
    }
}

/**
 * Live-ticking local time for a contact based on their IANA timezone.
 * Updates every 30s. Renders nothing if the timezone is missing/invalid.
 *
 * `variant="card"` → compact "3:42 PM" with a clock glyph.
 * `variant="header"` → "3:42 PM their time".
 */
export function LocalTime({
    timezone,
    variant = "card",
    className,
}: {
    timezone: string | null | undefined;
    variant?: "card" | "header";
    className?: string;
}) {
    const [time, setTime] = useState<string | null>(() => (timezone ? timeInZone(timezone) : null));

    useEffect(() => {
        if (!timezone) {
            setTime(null);
            return;
        }
        const tick = () => setTime(timeInZone(timezone));
        tick();
        const id = setInterval(tick, 30_000);
        return () => clearInterval(id);
    }, [timezone]);

    if (!time) return null;

    return (
        <span className={cx("inline-flex items-center gap-1 text-xs text-tertiary tabular-nums", className)} title={`Local time in ${timezone}`}>
            <Clock className="size-3 shrink-0" aria-hidden="true" />
            {variant === "header" ? `${time} their time` : time}
        </span>
    );
}
