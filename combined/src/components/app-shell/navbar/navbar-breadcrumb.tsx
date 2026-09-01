"use client";

import type { FC } from "react";
import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Activity,
    ActivityHeart,
    BankNote03,
    BookOpen01,
    Briefcase01,
    Calendar,
    CheckDone01,
    ChevronRight,
    Home01,
    MusicNote01,
    Scales01,
    Settings01,
    Target04,
    Users01,
} from "@untitledui/icons";
import { crumbsFromPath } from "@/components/app-shell/breadcrumbs";

/** Section icon keyed by the first path segment, matching the sidebar. */
const SECTION_ICON: Record<string, FC<{ className?: string }>> = {
    dashboard: Home01,
    career: Briefcase01,
    health: ActivityHeart,
    nutrition: Scales01,
    workouts: Activity,
    music: MusicNote01,
    financial: BankNote03,
    social: Users01,
    learning: BookOpen01,
    calendar: Calendar,
    focus: Target04,
    todos: CheckDone01,
    settings: Settings01,
};

/**
 * Left side of the desktop top navbar: a framed section icon, the ancestor
 * breadcrumb trail (Home › …), and the current page as the bold title beneath it.
 * Opaque id segments are dropped, so a detail route reads "Career › Applications".
 */
export function NavbarBreadcrumb() {
    const pathname = usePathname();
    const crumbs = crumbsFromPath(pathname);
    if (crumbs.length === 0) return null;

    const ancestors = crumbs.slice(0, -1);
    const current = crumbs[crumbs.length - 1];
    const section = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
    const Icon = SECTION_ICON[section] ?? Home01;

    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-fg-secondary ring-1 ring-secondary ring-inset">
                <Icon className="size-5" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col justify-center">
                <h1 className="truncate text-md font-semibold text-primary" aria-current="page">
                    {current.label}
                </h1>
                {/* Breadcrumb trail sits BENEATH the title; only shown on nested pages so a
                    top-level page (Dashboard, To-dos, …) doesn't render a lone Home icon. */}
                {ancestors.length > 0 && (
                    <nav aria-label="Breadcrumb" className="mt-0.5 flex min-w-0 items-center gap-1 text-xs">
                        <Link
                            href="/dashboard"
                            aria-label="Home"
                            className="flex shrink-0 items-center text-fg-quaternary transition duration-100 ease-linear hover:text-fg-secondary"
                        >
                            <Home01 className="size-3.5" aria-hidden="true" />
                        </Link>
                        {ancestors.map((c) => (
                            <Fragment key={c.href}>
                                <ChevronRight className="size-3.5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                <Link href={c.href} className="truncate text-tertiary transition duration-100 ease-linear hover:text-secondary">
                                    {c.label}
                                </Link>
                            </Fragment>
                        ))}
                    </nav>
                )}
            </div>
        </div>
    );
}
