// @ts-nocheck
import { Badge } from "@/components/base/badges/badges";
import { cx } from "@/utils/cx";
import { categoryColor, categoryIcon } from "./category-icons";

/** Squared modern category chip — color-coordinated with icon, Untitled UI-friendly. */
export function CategoryBadge({ name, color }: { name: string; color?: string | null }) {
    const Icon = categoryIcon(name);
    const resolved = categoryColor(name, color);
    if (!resolved) {
        return (
            <Badge color="gray" size="sm" type="modern">
                <Icon className="size-3.5" /> {name}
            </Badge>
        );
    }
    return (
        <span
            className={cx("inline-flex min-w-0 max-w-full shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset")}
            style={{ backgroundColor: `${resolved}18`, color: resolved, borderColor: `${resolved}40` }}
        >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{name}</span>
        </span>
    );
}
