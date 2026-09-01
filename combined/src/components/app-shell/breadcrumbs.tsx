"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";

/** Friendly labels for known route segments; others are title-cased from the slug. */
const SEGMENT_LABELS: Record<string, string> = {
    dashboard: "Dashboard",
    career: "Career",
    financial: "Financial",
    health: "Health",
    nutrition: "Nutrition",
    workouts: "Workouts",
    learning: "Learning",
    social: "Social",
    calendar: "Calendar",
    peptides: "Peptides",
    settings: "Settings",
    todos: "To-dos",
    focus: "Focus",
    notifications: "Notifications",
    new: "New",
    edit: "Edit",
};

function titleCase(seg: string): string {
    return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Opaque ids (cuid/uuid/numeric) read as "Details" rather than a raw key. */
function isIdLike(seg: string): boolean {
    return /^[0-9a-f]{8,}$/i.test(seg) || /^\d+$/.test(seg) || /^c[a-z0-9]{20,}$/i.test(seg);
}

function labelFor(seg: string): string {
    if (SEGMENT_LABELS[seg]) return SEGMENT_LABELS[seg];
    return titleCase(decodeURIComponent(seg));
}

/** Build display crumbs from a path, dropping opaque id segments (they read as a meaningless "Details"). */
export function crumbsFromPath(pathname: string): { label: string; href: string }[] {
    const raw = pathname.split("/").filter(Boolean);
    return raw
        .map((seg, i) => ({ seg, href: "/" + raw.slice(0, i + 1).join("/") }))
        .filter((c) => !isIdLike(c.seg))
        .map((c) => ({ label: labelFor(c.seg), href: c.href }));
}

/**
 * Untitled UI breadcrumb trail derived from the current route. A Home link, then a
 * crumb per path segment with chevron separators; the final crumb is the current page.
 */
export function Breadcrumbs({ className }: { className?: string }) {
    const pathname = usePathname();
    const crumbs = crumbsFromPath(pathname);

    // Nothing meaningful to show on top-level pages (just the current page) — hide it.
    if (crumbs.length <= 1) return null;

    return (
        <nav aria-label="Breadcrumb" className={cx("flex min-w-0 items-center gap-1.5 text-sm", className)}>
            <Link
                href="/dashboard"
                aria-label="Home"
                className="flex shrink-0 items-center text-fg-quaternary transition duration-100 ease-linear hover:text-fg-secondary"
            >
                <Home01 className="size-4" aria-hidden="true" />
            </Link>
            {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                    <Fragment key={c.href}>
                        <ChevronRight className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                        {last ? (
                            <span className="truncate font-medium text-secondary" aria-current="page">
                                {c.label}
                            </span>
                        ) : (
                            <Link href={c.href} className="shrink-0 text-tertiary transition duration-100 ease-linear hover:text-secondary">
                                {c.label}
                            </Link>
                        )}
                    </Fragment>
                );
            })}
        </nav>
    );
}
