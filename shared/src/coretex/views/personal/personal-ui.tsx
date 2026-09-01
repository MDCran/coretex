import type { FC, ReactNode } from "react";
import { AlertCircle, RefreshCcw01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";

export interface PersonalTab {
    id: string;
    label: string;
}

export interface ModuleHeroAction {
    label: string;
    icon?: FC<{ className?: string }>;
    onClick: () => void;
    /** "primary" renders a solid white button; "secondary" a translucent outline. Defaults to secondary. */
    variant?: "primary" | "secondary";
}

export interface ModuleHeroConfig {
    /** CSS gradient painted behind the banner. */
    gradient: string;
    /** Small label shown in the status pill above the title. */
    eyebrow?: string;
    /** Call-to-action buttons, mirroring the home dashboard hero. */
    actions?: ModuleHeroAction[];
}

/** A vivid gradient hero banner (matching the home dashboard) used as a module's header. */
function ModuleHero({ title, description, icon: Icon, hero }: { title: string; description: string; icon: FC<{ className?: string }>; hero: ModuleHeroConfig }) {
    return (
        <header
            className="relative isolate overflow-hidden rounded-2xl p-5 shadow-xl sm:p-6"
            style={{ background: hero.gradient, border: "1px solid color-mix(in srgb, #fff 18%, transparent)" }}
        >
            {/* Decorative blooms + grid for depth */}
            <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full opacity-40 blur-3xl" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.6), transparent 65%)" }} />
            <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 size-72 rounded-full opacity-20 blur-3xl" style={{ background: "radial-gradient(circle, #fde68a, transparent 65%)" }} />
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 max-w-2xl">
                    {hero.eyebrow && (
                        <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-white" style={{ background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.22)" }}>
                            <span className="relative flex size-1.5">
                                <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                                <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                            </span>
                            {hero.eyebrow}
                        </span>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)" }}>
                            <Icon className="size-6" />
                        </span>
                        <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
                    </div>
                    <p className="mt-2 max-w-xl text-sm text-white/85 sm:text-base">{description}</p>

                    {hero.actions && hero.actions.length > 0 && (
                        <div className="mt-5 flex flex-wrap items-center gap-2.5">
                            {hero.actions.map((action) => {
                                const ActionIcon = action.icon;
                                if (action.variant === "primary") {
                                    return (
                                        <button key={action.label} type="button" onClick={action.onClick} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2.5 text-sm font-semibold shadow-xs transition hover:bg-white/90" style={{ color: "#1f2937" }}>
                                            {ActionIcon && <ActionIcon className="size-4" />} {action.label}
                                        </button>
                                    );
                                }
                                return (
                                    <button key={action.label} type="button" onClick={action.onClick} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15" style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.28)" }}>
                                        {ActionIcon && <ActionIcon className="size-4" />} {action.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Glassy emblem */}
                <div aria-hidden className="hidden shrink-0 lg:block">
                    <div className="flex size-24 items-center justify-center rounded-3xl" style={{ background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.28)", backdropFilter: "blur(6px)" }}>
                        <Icon className="size-12 text-white drop-shadow" />
                    </div>
                </div>
            </div>
        </header>
    );
}

export function PersonalModuleShell({
    title,
    description,
    icon: Icon,
    tabs,
    activeTab,
    onTabChange,
    wrapTabs = false,
    hero,
    children,
}: {
    title: string;
    description: string;
    icon: FC<{ className?: string }>;
    tabs: PersonalTab[];
    activeTab: string;
    onTabChange: (tab: string) => void;
    wrapTabs?: boolean;
    hero?: ModuleHeroConfig;
    children: ReactNode;
}) {
    return (
        <section className="mx-auto flex min-h-full min-w-0 w-full max-w-[1600px] flex-col gap-5" data-personal-module={title.toLowerCase()}>
            {hero ? (
                <ModuleHero title={title} description={description} icon={Icon} hero={hero} />
            ) : (
                <header className="flex flex-col gap-4 rounded-2xl border border-secondary bg-primary p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3.5">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-secondary text-brand-secondary">
                            <Icon className="size-5" />
                        </span>
                        <div className="min-w-0">
                            <h1 className="text-xl font-semibold text-primary">{title}</h1>
                            <p className="mt-0.5 text-sm text-tertiary">{description}</p>
                        </div>
                    </div>
                </header>
            )}

            {tabs.length > 1 && (
                <nav className={cx("scrollbar-hide flex min-w-0 max-w-full gap-1 rounded-xl border border-secondary bg-primary p-1.5", wrapTabs ? "flex-wrap" : "overflow-x-auto overscroll-x-contain")} aria-label={`${title} sections`}>
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            data-testid={`personal-tab-${tab.id}`}
                            aria-current={activeTab === tab.id ? "page" : undefined}
                            onClick={() => onTabChange(tab.id)}
                            className={cx(
                                "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition",
                                activeTab === tab.id
                                    ? "bg-brand-solid text-white shadow-xs"
                                    : "text-secondary hover:bg-secondary hover:text-primary",
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>
            )}

            <div className="min-h-[320px] min-w-0 flex-1">{children}</div>
        </section>
    );
}

export function QueryBoundary({
    loading,
    error,
    onRetry,
    children,
}: {
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    children: ReactNode;
}) {
    if (loading) {
        return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading personal data">
                {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="h-28 animate-pulse rounded-xl border border-secondary bg-primary" />
                ))}
            </div>
        );
    }
    if (error) {
        return (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-error_subtle bg-error-primary p-8 text-center">
                <AlertCircle className="size-8 text-error-primary" />
                <div>
                    <h2 className="text-md font-semibold text-primary">Could not load this section</h2>
                    <p className="mt-1 max-w-xl text-sm text-tertiary">{error}</p>
                </div>
                <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white">
                    <RefreshCcw01 className="size-4" /> Retry
                </button>
            </div>
        );
    }
    return <>{children}</>;
}

export function StatGrid({ stats }: { stats: Array<{ label: string; value: ReactNode; detail?: ReactNode }> }) {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
                <div key={stat.label} className="rounded-xl border border-secondary bg-primary p-4 shadow-xs">
                    <p className="text-sm text-tertiary">{stat.label}</p>
                    <p className="mt-1 text-2xl font-semibold text-primary">{stat.value}</p>
                    {stat.detail != null && <p className="mt-1 text-xs text-quaternary">{stat.detail}</p>}
                </div>
            ))}
        </div>
    );
}

export function PersonalCard({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <div className={cx("min-w-0 overflow-hidden rounded-xl border border-secondary bg-primary shadow-xs", className)}>
            {(title || action) && (
                <div className="flex flex-col items-stretch gap-3 border-b border-secondary px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    {title && <h2 className="min-w-0 break-words text-md font-semibold text-primary">{title}</h2>}
                    {action && <div className="min-w-0 max-w-full sm:shrink-0">{action}</div>}
                </div>
            )}
            <div className="min-w-0 p-4 sm:p-5">{children}</div>
        </div>
    );
}

export interface TableColumn<Row> {
    key: string;
    label: string;
    render: (row: Row) => ReactNode;
    align?: "left" | "right";
}

export function PersonalTable<Row extends { id?: string }>({ rows, columns, empty }: { rows: Row[]; columns: TableColumn<Row>[]; empty: string }) {
    if (rows.length === 0) return <EmptyMessage>{empty}</EmptyMessage>;
    return (
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[640px] text-sm">
                <thead>
                    <tr className="border-b border-secondary text-left text-xs font-semibold uppercase tracking-wide text-quaternary">
                        {columns.map((column) => (
                            <th key={column.key} className={cx("px-3 py-2.5", column.align === "right" && "text-right")}>{column.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-secondary">
                    {rows.map((row, index) => (
                        <tr key={row.id ?? index} className="text-secondary hover:bg-primary_hover">
                            {columns.map((column) => (
                                <td key={column.key} className={cx("px-3 py-3", column.align === "right" && "text-right")}>{column.render(row)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function EmptyMessage({ children }: { children: ReactNode }) {
    return <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-secondary px-5 py-8 text-center text-sm text-tertiary">{children}</div>;
}

export function ProgressMeter({ value, max, label }: { value: number; max: number; label?: string }) {
    const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return (
        <div>
            {label && <div className="mb-1.5 flex justify-between text-xs text-tertiary"><span>{label}</span><span>{Math.round(percentage)}%</span></div>}
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-brand-solid transition-[width]" style={{ width: `${percentage}%` }} />
            </div>
        </div>
    );
}

export function formatCurrency(value: number, currency = "USD") {
    // Ledger values must retain their cents; rounding hid the actual amount.
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}

/** Compact currency for chart axis ticks, e.g. $12.3K. */
export function formatCompact(value: number | null | undefined, currency = "USD") {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

/** Full calendar date as zero-padded MM/DD/YYYY. Safe with a single argument
 * (unlike date-fns's format/formatDate, which throws without a format string). */
export function formatDate(value: string | Date | null | undefined) {
    if (!value) return "—";
    // A bare ISO date represents a calendar day, not a UTC instant. Parsing it
    // as UTC would display the previous day in negative-offset time zones.
    const date = value instanceof Date
        ? value
        : /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? new Date(`${value}T12:00:00`)
            : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${mm}/${dd}/${date.getFullYear()}`;
}

/** Month-and-year only, as MM/YYYY. Accepts a Date, an ISO date, or a "YYYY-MM" bucket key. */
export function formatMonthYear(value: string | Date | null | undefined) {
    if (!value) return "—";
    if (typeof value === "string") {
        const m = value.match(/^(\d{4})-(\d{2})/);
        if (m) return `${m[2]}/${m[1]}`;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

/** Return a YYYY-MM-DD key for the local calendar day, without UTC rollover. */
export function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function titleCase(value: string | null | undefined) {
    if (!value) return "—";
    return value.toLowerCase().replace(/(^|[_\s-])\w/g, (match) => match.replace(/[_-]/, " ").toUpperCase());
}
