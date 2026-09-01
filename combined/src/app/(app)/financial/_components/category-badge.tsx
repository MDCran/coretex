"use client";

import { Badge } from "@/components/base/badges/badges";
import { cx } from "@/utils/cx";

/** Squared modern category chip — Untitled UI `type="modern"`. */
export function CategoryBadge({ name, color }: { name: string; color?: string | null }) {
    if (!color) {
        return (
            <Badge color="gray" size="sm" type="modern">
                {name}
            </Badge>
        );
    }
    return (
        <span
            className={cx("inline-flex min-w-0 max-w-full shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset")}
            style={{ backgroundColor: `${color}18`, color, borderColor: `${color}40` }}
        >
            <span className="inline-block size-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
            <span className="truncate">{name}</span>
        </span>
    );
}
