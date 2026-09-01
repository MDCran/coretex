import type { FC } from "react";
import Link from "next/link";
import { cx } from "@/utils/cx";

export interface DashboardStat {
    label: string;
    value: string;
    detail?: string;
    href?: string;
    icon: FC<{ className?: string }>;
    tone?: "default" | "success" | "warning" | "brand";
}

const toneClass: Record<NonNullable<DashboardStat["tone"]>, string> = {
    default: "text-primary",
    success: "text-success-primary",
    warning: "text-warning-primary",
    brand: "text-brand-secondary",
};

export function DashboardStats({ stats }: { stats: DashboardStat[] }) {
    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {stats.map((s) => {
                const Icon = s.icon;
                const inner = (
                    <>
                        <div className="flex items-center justify-between gap-2">
                            <Icon className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                            <span className="truncate text-xs font-medium text-tertiary">{s.label}</span>
                        </div>
                        <p className={cx("text-lg font-semibold tabular-nums sm:text-xl", toneClass[s.tone ?? "default"])}>{s.value}</p>
                        {s.detail && <p className="truncate text-xs text-tertiary">{s.detail}</p>}
                    </>
                );
                const className =
                    "flex flex-col gap-1.5 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover";
                return s.href ? (
                    <Link key={s.label} href={s.href} className={className}>
                        {inner}
                    </Link>
                ) : (
                    <div key={s.label} className={className}>
                        {inner}
                    </div>
                );
            })}
        </div>
    );
}
