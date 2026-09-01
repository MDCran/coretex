import { CheckCircle, AlertTriangle, XCircle, MinusCircle, RefreshCcw01 } from "@untitledui/icons";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { Button } from "@/components/base/buttons/button";
import { requireUser } from "@/lib/auth";
import { probeSystems, type HealthStatus } from "@/lib/health";
import { formatDateTime } from "@/lib/dates";
import { cx } from "@/utils/cx";

export const dynamic = "force-dynamic";

const STATUS_META: Record<HealthStatus, { label: string; dot: string; text: string; icon: typeof CheckCircle }> = {
    ok: { label: "Operational", dot: "bg-success-solid", text: "text-success-primary", icon: CheckCircle },
    degraded: { label: "Degraded", dot: "bg-warning-solid", text: "text-warning-primary", icon: AlertTriangle },
    down: { label: "Down", dot: "bg-error-solid", text: "text-error-primary", icon: XCircle },
    not_configured: { label: "Not configured", dot: "bg-fg-quaternary", text: "text-tertiary", icon: MinusCircle },
};

export default async function StatusPage() {
    await requireUser();
    const health = await probeSystems();
    const overall = STATUS_META[health.status];
    const OverallIcon = overall.icon;

    return (
        <ModulePageShell title="System status" description="Live health of the services LifeOS depends on.">
            <div className="flex max-w-3xl flex-col gap-5">
                {/* Overall banner */}
                <div
                    className={cx(
                        "relative flex items-center gap-4 overflow-hidden rounded-2xl p-5 ring-1 ring-inset sm:p-6",
                        health.status === "ok" ? "bg-success-secondary ring-success-primary/20" : health.status === "down" ? "bg-error-secondary ring-error-primary/20" : "bg-warning-secondary ring-warning-primary/20",
                    )}
                >
                    <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/60", overall.text)}>
                        <OverallIcon className="size-6" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <p className={cx("text-lg font-semibold", overall.text)}>
                            {health.status === "ok" ? "All systems operational" : health.status === "down" ? "Major outage" : "Partial degradation"}
                        </p>
                        <p className="text-sm text-tertiary">Last checked {formatDateTime(health.checkedAt)}</p>
                    </div>
                </div>

                {/* Component list */}
                <div className="overflow-hidden rounded-2xl bg-primary ring-1 ring-secondary ring-inset">
                    <ul className="flex flex-col divide-y divide-secondary">
                        {health.components.map((c) => {
                            const meta = STATUS_META[c.status];
                            return (
                                <li key={c.name} className="flex items-center justify-between gap-4 px-5 py-4">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span className={cx("size-2.5 shrink-0 rounded-full", meta.dot)} aria-hidden="true" />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-primary">{c.name}</p>
                                            {c.detail && <p className="truncate text-xs text-tertiary">{c.detail}</p>}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3">
                                        {c.latencyMs != null && <span className="text-xs tabular-nums text-quaternary">{c.latencyMs} ms</span>}
                                        <span className={cx("text-sm font-medium", meta.text)}>{meta.label}</span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-tertiary">
                        Machine-readable probe at <code className="rounded bg-secondary px-1 text-xs">/api/health</code>.
                    </p>
                    <Button href="/status" size="sm" color="secondary" iconLeading={<RefreshCcw01 className="size-4" data-icon />}>
                        Refresh
                    </Button>
                </div>
            </div>
        </ModulePageShell>
    );
}
