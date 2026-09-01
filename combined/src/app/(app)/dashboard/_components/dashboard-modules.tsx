import type { FC } from "react";
import Link from "next/link";
import { ArrowRight } from "@untitledui/icons";
import { cx } from "@/utils/cx";

export type ModuleColor = "blue" | "green" | "purple" | "orange" | "indigo" | "pink" | "yellow" | "fuchsia";

export interface ModuleCard {
    label: string;
    href: string;
    icon: FC<{ className?: string }>;
    stat: string;
    detail: string;
    color: ModuleColor;
}

// Tinted icon chip per module so the grid reads as eight distinct destinations
// instead of one repeated card.
const chipClass: Record<ModuleColor, string> = {
    blue: "bg-utility-blue-50 text-utility-blue-700 ring-utility-blue-100",
    green: "bg-utility-green-50 text-utility-green-700 ring-utility-green-100",
    purple: "bg-utility-purple-50 text-utility-purple-700 ring-utility-purple-100",
    orange: "bg-utility-orange-50 text-utility-orange-700 ring-utility-orange-100",
    indigo: "bg-utility-indigo-50 text-utility-indigo-700 ring-utility-indigo-100",
    pink: "bg-utility-pink-50 text-utility-pink-700 ring-utility-pink-100",
    yellow: "bg-utility-yellow-50 text-utility-yellow-700 ring-utility-yellow-100",
    fuchsia: "bg-utility-fuchsia-50 text-utility-fuchsia-700 ring-utility-fuchsia-100",
};

export function DashboardModules({ modules }: { modules: ModuleCard[] }) {
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {modules.map((m) => {
                const Icon = m.icon;
                return (
                    <Link
                        key={m.href}
                        href={m.href}
                        className="group flex items-center gap-3.5 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                    >
                        <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", chipClass[m.color])}>
                            <Icon className="size-5" aria-hidden="true" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-sm font-semibold text-primary">{m.label}</span>
                                <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{m.stat}</span>
                            </span>
                            <span className="truncate text-xs text-tertiary">{m.detail}</span>
                        </span>
                        <ArrowRight
                            className="size-4 shrink-0 text-fg-quaternary opacity-0 transition duration-100 ease-linear group-hover:opacity-100"
                            aria-hidden="true"
                        />
                    </Link>
                );
            })}
        </div>
    );
}
