import type { FC } from "react";
import Link from "next/link";
import { ArrowRight, BankNote03, CalendarHeart01, Stars02, Users01 } from "@untitledui/icons";
import { isHrefEnabled, type AreaKey } from "@/lib/areas";
import { cx } from "@/utils/cx";

interface Promo {
    area: AreaKey;
    href: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    cta: string;
    icon: FC<{ className?: string }>;
    gradient: string;
}

// Conversion-style "ad" cards: vibrant gradients, an illustrative icon, and a clear CTA.
const PROMOS: Promo[] = [
    {
        area: "music",
        href: "/music",
        eyebrow: "AI · Spotify",
        title: "Build an AI mood playlist",
        subtitle: "Tell LifeOS how you feel and get a tailored playlist on your Spotify in seconds.",
        cta: "Generate a playlist",
        icon: Stars02,
        gradient: "from-utility-purple-600 to-utility-pink-600",
    },
    {
        area: "financial",
        href: "/financial",
        eyebrow: "Net worth",
        title: "See all your money in one place",
        subtitle: "Connect accounts, track spending, and watch your net worth grow over time.",
        cta: "Open Financial",
        icon: BankNote03,
        gradient: "from-utility-green-600 to-utility-blue-700",
    },
    {
        area: "calendar",
        href: "/calendar",
        eyebrow: "Plan ahead",
        title: "Plan your perfect week",
        subtitle: "Events, reminders and routines in one calendar so nothing slips through.",
        cta: "Plan my week",
        icon: CalendarHeart01,
        gradient: "from-utility-blue-600 to-utility-indigo-700",
    },
    {
        area: "social",
        href: "/social",
        eyebrow: "Relationships",
        title: "Never lose touch again",
        subtitle: "Smart reminders surface the people you're drifting from before it's too late.",
        cta: "Open Social",
        icon: Users01,
        gradient: "from-utility-pink-600 to-utility-fuchsia-700",
    },
];

export function DashboardPromos({ hiddenAreas = [] }: { hiddenAreas?: AreaKey[] }) {
    const promos = PROMOS.filter((p) => isHrefEnabled(p.href, hiddenAreas)).slice(0, 3);
    if (promos.length === 0) return null;

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {promos.map((p) => {
                const Icon = p.icon;
                return (
                    <Link
                        key={p.area}
                        href={p.href}
                        className={cx(
                            "group relative flex flex-col justify-between gap-6 overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-md ring-1 ring-black/5 transition duration-150 ease-linear hover:shadow-xl",
                            p.gradient,
                        )}
                    >
                        {/* Decorative oversized glyph */}
                        <Icon className="pointer-events-none absolute -top-6 -right-6 size-32 text-white/10 transition duration-300 group-hover:scale-110" aria-hidden="true" />

                        <div className="relative flex flex-col gap-2">
                            <span className="inline-flex w-fit items-center rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-white uppercase ring-1 ring-white/25 ring-inset backdrop-blur-sm">
                                {p.eyebrow}
                            </span>
                            <span className="flex size-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 ring-inset backdrop-blur-sm">
                                <Icon className="size-6" aria-hidden="true" />
                            </span>
                            <h3 className="mt-1 text-lg font-semibold text-white">{p.title}</h3>
                            <p className="text-sm text-white/80">{p.subtitle}</p>
                        </div>

                        <span className="relative inline-flex w-fit items-center gap-1.5 rounded-lg bg-white/15 px-3.5 py-2 text-sm font-semibold text-white ring-1 ring-white/30 ring-inset backdrop-blur-sm transition duration-100 ease-linear group-hover:bg-white/25">
                            {p.cta}
                            <ArrowRight className="size-4 transition duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                        </span>
                    </Link>
                );
            })}
        </div>
    );
}
