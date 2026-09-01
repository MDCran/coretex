"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins01, CurrencyDollarCircle, Lightning01, Trash02 } from "@untitledui/icons";
import { SettingsNotice } from "@/components/settings/settings-notice";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { IntegrationStatusChip } from "@/components/settings/integration-status-badges";
import { Toggle } from "@/components/base/toggle/toggle";
import { Slider } from "@/components/base/slider/slider";
import { Input } from "@/components/base/input/input";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { SelectInput, TextareaInput } from "@/components/jobs/fields";
import { TrendChart } from "@/app/(app)/health/_components/trend-chart";
import { formatDateTime } from "@/lib/dates";
import { updateAiSettings } from "@/lib/actions/settings";
import { setAiEnabled, setAiMonthlyLimit, setAiPerSearchLimit } from "@/lib/actions/ai-settings";
import { purgeDeletedRoles } from "@/lib/actions/job-search";

export interface AiCallRow {
    id: string;
    createdAt: string;
    purpose: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number | null;
    errored: boolean;
    errorMessage: string | null;
}

export interface DayCost {
    label: string;
    cost: number;
    [key: string]: string | number;
}

interface Props {
    configured: boolean;
    models: string[];
    defaultModel: string;
    settings: {
        aiEnabled: boolean;
        aiModel: string | null;
        aiBudgetUsd: number | null;
        coachStyle: string | null;
        aiMonthlyLimitUsd: number | null;
        aiPerSearchLimitUsd: number | null;
    };
    monthSpend: number;
    allTimeSpend: number;
    totalRequests: number;
    avgLatencyMs: number | null;
    dailyCosts: DayCost[];
    calls: AiCallRow[];
    pageSize: number;
    totalCalls: number;
    deletedRolesCount: number;
}

function money(n: number, digits = 2) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

function modelLabel(id: string) {
    // claude-opus-4-8 -> "Claude Opus 4.8"
    const parts = id.split("-");
    if (parts[0] === "claude" && parts.length >= 4) {
        const family = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
        return `Claude ${family} ${parts[2]}.${parts[3]}`;
    }
    return id;
}

function formatTimestamp(iso: string) {
    return formatDateTime(iso);
}

/** Monthly AI spend cap as a slider, wired into the form via a hidden input. */
function BudgetSlider({ defaultValue }: { defaultValue: number | null }) {
    const [value, setValue] = useState(Math.round(defaultValue ?? 0));
    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-secondary">Monthly budget</label>
                <span className="text-sm font-semibold tabular-nums text-primary">{value <= 0 ? "No limit" : money(value)}</span>
            </div>
            <input type="hidden" name="aiBudgetUsd" value={value} />
            <Slider
                aria-label="Monthly AI budget in US dollars"
                minValue={0}
                maxValue={200}
                step={5}
                value={[value]}
                onChange={(v) => setValue(Array.isArray(v) ? v[0] : v)}
            />
            <p className="text-xs text-tertiary">A soft limit shown against your current spend. Slide to 0 for no limit.</p>
        </div>
    );
}

/**
 * A hard-enforced USD spend-limit input that saves on blur/Enter. Empty value means
 * "no limit" and is persisted as null.
 */
function LimitInput({
    label,
    hint,
    icon,
    defaultValue,
    onSave,
}: {
    label: string;
    hint: string;
    icon: typeof Coins01;
    defaultValue: number | null;
    onSave: (usd: number | null) => Promise<void>;
}) {
    const [value, setValue] = useState(defaultValue != null ? String(defaultValue) : "");
    const [saved, setSaved] = useState(defaultValue != null ? String(defaultValue) : "");
    const [isPending, startTransition] = useTransition();

    function commit() {
        const trimmed = value.trim();
        if (trimmed === saved.trim()) return;

        let parsed: number | null = null;
        if (trimmed !== "") {
            const n = Number(trimmed);
            if (!Number.isFinite(n) || n < 0) {
                toast.error("Enter a valid dollar amount, or leave blank for no limit");
                setValue(saved);
                return;
            }
            parsed = n > 0 ? n : null;
        }

        const display = parsed != null ? String(parsed) : "";
        startTransition(async () => {
            try {
                await onSave(parsed);
                setSaved(display);
                setValue(display);
                toast.success(parsed != null ? `${label} set to ${money(parsed)}` : `${label} cleared`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not save limit");
                setValue(saved);
            }
        });
    }

    return (
        <Input
            type="number"
            inputMode="decimal"
            size="sm"
            icon={icon}
            label={label}
            placeholder="No limit"
            hint={hint}
            value={value}
            onChange={setValue}
            isDisabled={isPending}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                }
            }}
        />
    );
}

export function AiClient({
    configured,
    models,
    defaultModel,
    settings,
    monthSpend,
    allTimeSpend,
    totalRequests,
    avgLatencyMs,
    dailyCosts,
    calls,
    pageSize,
    totalCalls,
    deletedRolesCount,
}: Props) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [enabled, setEnabled] = useState(settings.aiEnabled);
    const [aiSwitchPending, startAiSwitch] = useTransition();

    // Removed-suggestions backup state.
    const [backupCount, setBackupCount] = useState(deletedRolesCount);
    const [purgePending, startPurge] = useTransition();

    // Client-side pagination over the already-loaded rows: paging never navigates,
    // so the table stays exactly where it is on screen (no scroll-to-top jump).
    const [tablePage, setTablePage] = useState(1);
    const totalPages = Math.max(1, Math.ceil(calls.length / pageSize));
    const safePage = Math.min(tablePage, totalPages);
    const pageRows = useMemo(() => calls.slice((safePage - 1) * pageSize, safePage * pageSize), [calls, safePage, pageSize]);

    const budget = settings.aiBudgetUsd ?? 0;
    const pct = budget > 0 ? Math.min(100, Math.round((monthSpend / budget) * 100)) : 0;

    function toggleAi(next: boolean) {
        const prev = enabled;
        setEnabled(next);
        startAiSwitch(async () => {
            try {
                await setAiEnabled(next);
                toast.success(next ? "AI features enabled" : "AI features paused");
            } catch (e) {
                setEnabled(prev);
                toast.error(e instanceof Error ? e.message : "Could not update AI switch");
            }
        });
    }

    function clearBackup() {
        startPurge(async () => {
            try {
                await purgeDeletedRoles();
                setBackupCount(0);
                toast.success("Removed-suggestions backup cleared");
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not clear backup");
            }
        });
    }

    async function onSubmit(fd: FormData) {
        setPending(true);
        try {
            await updateAiSettings(fd);
            toast.success("AI settings saved");
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex flex-col gap-6">
            {/* AI controls: master switch + hard spend limits + removed-suggestions backup */}
            <Card>
                <CardHeader
                    title="AI controls"
                    action={
                        <IntegrationStatusChip
                            label={enabled ? "AI active" : "AI paused"}
                            tone={enabled ? "success" : "warning"}
                            size="md"
                        />
                    }
                />
                <CardBody className="flex flex-col gap-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-sm font-medium text-secondary">Enable AI features</p>
                            <p className="text-sm text-tertiary">
                                Master switch for coaching, insights, suggestions and AI-powered searches across every module.
                            </p>
                        </div>
                        <Toggle isSelected={enabled} onChange={toggleAi} isDisabled={aiSwitchPending} aria-label="Enable AI features" />
                    </div>

                    {!enabled && (
                        <SettingsNotice status="warning" title="AI features are paused">
                            All AI features are turned off. No requests will be sent to Claude and no charges will be incurred until you re-enable
                            AI above.
                        </SettingsNotice>
                    )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <LimitInput
                            label="Monthly spend limit (USD)"
                            icon={Coins01}
                            hint="Hard cap per calendar month. AI requests are blocked once reached. Leave blank for no limit."
                            defaultValue={settings.aiMonthlyLimitUsd}
                            onSave={setAiMonthlyLimit}
                        />
                        <LimitInput
                            label="Per-search spend limit (USD)"
                            icon={CurrencyDollarCircle}
                            hint="Hard cap for a single search/run. The run stops once the estimated spend reaches this. Leave blank for no limit."
                            defaultValue={settings.aiPerSearchLimitUsd}
                            onSave={setAiPerSearchLimit}
                        />
                    </div>

                    <SettingsNotice status="info" title="Limits are hard-enforced">
                        These caps are checked on the server before each AI request, so they cannot be exceeded — unlike the monthly budget below,
                        which is only a visual guide.
                    </SettingsNotice>

                    {/* Removed suggestions backup */}
                    <div className="flex flex-col gap-3 rounded-lg bg-primary p-4 ring-1 ring-secondary ring-inset sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-col gap-0.5">
                            <span className="flex items-center gap-2 text-sm font-medium text-primary">
                                <Trash02 className="size-4 text-fg-quaternary" aria-hidden="true" />
                                Removed suggestions backup
                                <Badge color="gray" type="pill-color" size="sm">
                                    {backupCount.toLocaleString()} saved
                                </Badge>
                            </span>
                            <span className="text-sm text-tertiary">
                                Roles you remove from suggestions are kept here as a backup. Clearing is the only way to permanently delete them.
                            </span>
                        </div>
                        <Button
                            size="sm"
                            color="secondary-destructive"
                            iconLeading={Trash02}
                            isDisabled={backupCount === 0 || purgePending}
                            isLoading={purgePending}
                            showTextWhileLoading
                            onClick={clearBackup}
                        >
                            Clear backup
                        </Button>
                    </div>
                </CardBody>
            </Card>

            <form action={onSubmit} className="flex flex-col gap-6">
                {/* Mirror the master switch so "Save AI settings" preserves it (the toggle also instant-saves above). */}
                <input type="hidden" name="aiEnabled" value={enabled ? "true" : "false"} />

                <Card>
                    <CardHeader
                        title="AI assistant"
                        action={
                            configured ? (
                                <IntegrationStatusChip label="Configured" tone="success" size="md" />
                            ) : (
                                <IntegrationStatusChip label="Not configured" tone="warning" size="md" />
                            )
                        }
                    />
                    <CardBody className="flex flex-col gap-5">
                        <SettingsNotice
                            status={configured ? "success" : "warning"}
                            title={configured ? "Claude is connected" : "Claude is not connected"}
                        >
                            {configured
                                ? "AI features are powered by Anthropic's Claude models."
                                : "Requires ANTHROPIC_API_KEY on the server to enable AI features."}
                        </SettingsNotice>

                        <SelectInput
                            label="Default model"
                            name="aiModel"
                            id="aiModel"
                            defaultValue={settings.aiModel ?? defaultModel}
                            hint="The Claude model used for AI requests."
                            options={models.map((m) => ({ value: m, label: m === defaultModel ? `${modelLabel(m)} (default)` : modelLabel(m) }))}
                        />
                        <BudgetSlider defaultValue={settings.aiBudgetUsd} />

                        <div className="flex flex-col gap-2 rounded-lg bg-primary p-4 ring-1 ring-secondary ring-inset">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-secondary">Spend this month</span>
                                <span className="font-medium text-primary">
                                    {money(monthSpend)}
                                    {budget > 0 ? ` / ${money(budget)}` : ""}
                                </span>
                            </div>
                            {budget > 0 && (
                                <div className="h-2 w-full overflow-hidden rounded-full bg-quaternary">
                                    <div className={pct >= 100 ? "h-full rounded-full bg-error-solid" : "h-full rounded-full bg-brand-solid"} style={{ width: `${pct}%` }} />
                                </div>
                            )}
                        </div>

                        <TextareaInput
                            label="Coach style"
                            name="coachStyle"
                            id="coachStyle"
                            rows={4}
                            defaultValue={settings.coachStyle ?? ""}
                            placeholder="Describe how you'd like the AI to communicate with you…"
                        />

                        <div className="flex flex-col gap-2 rounded-lg bg-primary p-4 text-sm ring-1 ring-secondary ring-inset">
                            <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-primary">API key</span>
                                <IntegrationStatusChip
                                    label={configured ? "Configured" : "Missing"}
                                    tone={configured ? "success" : "warning"}
                                    size="sm"
                                />
                            </div>
                            <p className="font-mono text-secondary">
                                {configured ? "ANTHROPIC_API_KEY · ••••••••••••••••" : "ANTHROPIC_API_KEY not set"}
                            </p>
                            <p className="text-secondary">
                                The key is stored in server environment variables (not in the database). See{" "}
                                <a href="/settings/integrations" className="font-medium text-brand-secondary hover:underline">
                                    Integrations
                                </a>{" "}
                                for connection status.
                            </p>
                        </div>
                    </CardBody>
                </Card>

                <div className="flex justify-end">
                    <Button type="submit" isLoading={pending} showTextWhileLoading>
                        Save AI settings
                    </Button>
                </div>
            </form>

            {/* Requests & charges */}
            <Card>
                <CardHeader title="Requests & charges" />
                <CardBody className="flex flex-col gap-5">
                    {/* Summary chips */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Stat label="Total requests" value={totalRequests.toLocaleString()} />
                        <Stat label="Spend this month" value={money(monthSpend, 4)} />
                        <Stat label="Spend all time" value={money(allTimeSpend, 4)} />
                        <Stat label="Avg latency" value={avgLatencyMs != null ? `${Math.round(avgLatencyMs)} ms` : "—"} />
                    </div>

                    {/* Per-day cost chart */}
                    <div className="rounded-lg bg-secondary p-4">
                        <p className="mb-3 text-sm font-medium text-secondary">Daily cost (last 30 days)</p>
                        <TrendChart
                            data={dailyCosts}
                            series={[{ key: "cost", name: "Cost (USD)" }]}
                            type="bar"
                            height={200}
                            emptyLabel="No AI requests yet"
                        />
                    </div>

                    {/* Table */}
                    {calls.length === 0 ? (
                        <p className="text-sm text-tertiary">No AI requests yet. Charges will appear here once you use an AI feature.</p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg ring-1 ring-secondary ring-inset">
                            <table className="w-full min-w-180 text-sm">
                                <thead>
                                    <tr className="border-b border-secondary text-left text-xs text-tertiary">
                                        <th className="px-3 py-2.5 font-medium">When</th>
                                        <th className="px-3 py-2.5 font-medium">Purpose</th>
                                        <th className="px-3 py-2.5 font-medium">Model</th>
                                        <th className="px-3 py-2.5 text-right font-medium">In / Out tokens</th>
                                        <th className="px-3 py-2.5 text-right font-medium">Cost</th>
                                        <th className="px-3 py-2.5 text-right font-medium">Latency</th>
                                        <th className="px-3 py-2.5 font-medium">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((c) => (
                                        <tr key={c.id} className="border-b border-secondary last:border-0">
                                            <td className="px-3 py-2.5 whitespace-nowrap text-tertiary">{formatTimestamp(c.createdAt)}</td>
                                            <td className="px-3 py-2.5 font-medium text-primary">{c.purpose}</td>
                                            <td className="px-3 py-2.5 whitespace-nowrap text-tertiary">{modelLabel(c.model)}</td>
                                            <td className="px-3 py-2.5 text-right whitespace-nowrap text-tertiary">
                                                {c.inputTokens.toLocaleString()} / {c.outputTokens.toLocaleString()}
                                            </td>
                                            <td className="px-3 py-2.5 text-right whitespace-nowrap font-medium text-primary">{money(c.costUsd, 4)}</td>
                                            <td className="px-3 py-2.5 text-right whitespace-nowrap text-tertiary">{c.latencyMs != null ? `${c.latencyMs} ms` : "—"}</td>
                                            <td className="px-3 py-2.5">
                                                {c.errored ? (
                                                    <Tooltip title="Error" description={c.errorMessage ?? "The request failed."}>
                                                        <TooltipTrigger>
                                                            <Badge color="error" type="pill-color" size="sm">Error</Badge>
                                                        </TooltipTrigger>
                                                    </Tooltip>
                                                ) : (
                                                    <Badge color="success" type="pill-color" size="sm">Success</Badge>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="flex items-center justify-between gap-3 pt-1">
                            <span className="text-sm text-tertiary">
                                Page {safePage} of {totalPages}
                                {calls.length < totalCalls ? ` · newest ${calls.length.toLocaleString()} of ${totalCalls.toLocaleString()}` : ""}
                            </span>
                            <div className="flex gap-2">
                                <Button size="sm" color="secondary" isDisabled={safePage <= 1} onClick={() => setTablePage((p) => Math.max(1, p - 1))}>
                                    Previous
                                </Button>
                                <Button
                                    size="sm"
                                    color="secondary"
                                    isDisabled={safePage >= totalPages}
                                    onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                                >
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </CardBody>
            </Card>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-1 rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
            <span className="flex items-center gap-1.5 text-xs text-secondary">
                <Lightning01 className="size-3.5 text-fg-tertiary" aria-hidden="true" />
                {label}
            </span>
            <span className="text-lg font-semibold text-primary">{value}</span>
        </div>
    );
}
