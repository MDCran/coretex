"use client";

import { useEffect, useState } from "react";
import { Clock } from "@untitledui/icons";
import { timeInZone } from "@/lib/jobs/format";

/** Shows the contact's current local time, ticking once a minute. */
export function LiveClock({ timezone }: { timezone: string }) {
    const [now, setNow] = useState<Date | null>(null);

    useEffect(() => {
        setNow(new Date());
        const t = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(t);
    }, []);

    return (
        <span className="inline-flex items-center gap-1.5 text-sm text-tertiary">
            <Clock className="size-4" />
            {now ? `${timeInZone(timezone, now)} local` : "…"}
        </span>
    );
}
