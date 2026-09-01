"use client";

import type { FC } from "react";
import Link from "next/link";
import {
    Activity,
    BankNote03,
    Beaker02,
    Bell01,
    Briefcase01,
    CalendarPlus01,
    CheckDone01,
    Heart,
    Moon01,
    Scales01,
    UserPlus01,
} from "@untitledui/icons";
import { isHrefEnabled, type AreaKey } from "@/lib/areas";
import { cx } from "@/utils/cx";

interface ActionLink {
    label: string;
    icon: FC<{ className?: string }>;
    href?: string;
    /** Scroll to + focus an in-page anchor instead of navigating. */
    anchorId?: string;
}

/** Root area href for an action, e.g. "/health/peptides" → "/health". */
function areaRoot(href?: string): string | undefined {
    if (!href) return undefined;
    const seg = href.split("/")[1];
    return seg ? `/${seg}` : undefined;
}

const ACTIONS: ActionLink[] = [
    { label: "Add to-do", icon: CheckDone01, anchorId: "dashboard-quick-add-todo" },
    { label: "Log workout", icon: Activity, href: "/workouts/log" },
    { label: "Log food", icon: Heart, href: "/nutrition" },
    { label: "Log dose", icon: Beaker02, href: "/health/peptides" },
    { label: "Log weight", icon: Scales01, href: "/health/metrics" },
    { label: "Log sleep", icon: Moon01, href: "/health/sleep" },
    { label: "Add transaction", icon: BankNote03, href: "/financial/transactions" },
    { label: "New event", icon: CalendarPlus01, href: "/calendar" },
    { label: "New reminder", icon: Bell01, href: "/calendar/reminders" },
    { label: "Add contact", icon: UserPlus01, href: "/social/contacts/new" },
    { label: "New application", icon: Briefcase01, href: "/career/applications/new" },
];

const baseClass =
    "inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-secondary shadow-xs ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover hover:text-primary";

function scrollToAnchor(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const input = el.querySelector<HTMLInputElement>("input");
    input?.focus();
}

export function QuickActions({ hiddenAreas = [] }: { hiddenAreas?: AreaKey[] }) {
    const actions = ACTIONS.filter((a) => isHrefEnabled(areaRoot(a.href), hiddenAreas));

    return (
        <div className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-tertiary uppercase">Quick actions</h2>
            <div className="flex flex-wrap gap-2">
            {actions.map((a) => {
                const Icon = a.icon;
                if (a.anchorId) {
                    return (
                        <button key={a.label} type="button" onClick={() => scrollToAnchor(a.anchorId!)} className={cx(baseClass)}>
                            <Icon className="size-4 text-fg-quaternary" aria-hidden="true" />
                            {a.label}
                        </button>
                    );
                }
                return (
                    <Link key={a.label} href={a.href!} className={baseClass}>
                        <Icon className="size-4 text-fg-quaternary" aria-hidden="true" />
                        {a.label}
                    </Link>
                );
            })}
            </div>
        </div>
    );
}
