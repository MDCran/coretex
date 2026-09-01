"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BatteryFull, Plus, X, Edit01, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { TextareaInput, DateInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { Card, CardBody, CardHeader, EmptyHint } from "@/components/social/ui";
import { formatDateShort } from "@/lib/dates";
import { toDateInput } from "@/lib/social/format";

function batteryColor(level: number): "error" | "warning" | "success" {
    if (level <= 3) return "error";
    if (level <= 6) return "warning";
    return "success";
}

const tooltipStyle = {
    backgroundColor: "var(--color-bg-primary)",
    border: "1px solid var(--color-border-secondary)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--color-text-primary)",
};

export type BatteryLog = { id: string; date: string; energyLevel: number; notes: string | null };

type Action = (formData: FormData) => Promise<void>;

function LogDialog({
    open,
    onOpenChange,
    log,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    log?: BatteryLog;
    onSubmit: (fd: FormData) => Promise<void>;
}) {
    const [level, setLevel] = useState<number>(log?.energyLevel ?? 5);

    async function handle(fd: FormData) {
        fd.set("energyLevel", String(level));
        try {
            await onSubmit(fd);
            toast.success(log ? "Log updated" : "Battery logged");
            onOpenChange(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    const title = log ? "Edit battery log" : "Log social battery";

    return (
        <ModalOverlay isDismissable isOpen={open} onOpenChange={onOpenChange}>
            <Modal className="max-w-sm">
                <Dialog aria-label={title}>
                    <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                        <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                            <h2 className="text-md font-semibold text-primary">{title}</h2>
                            <Button color="tertiary" size="sm" iconLeading={X} onClick={() => onOpenChange(false)} aria-label="Close" />
                        </div>
                        <form action={handle} className="flex flex-col gap-4 p-5">
                            <DateInput name="date" label="Date" isRequired defaultValue={toDateInput(log?.date ?? new Date())} />
                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium text-secondary">Energy level</span>
                                    <span className="font-semibold text-primary">{level}/10</span>
                                </div>
                                <input type="range" min={1} max={10} value={level} onChange={(e) => setLevel(Number(e.target.value))} className="w-full accent-brand-solid" aria-label="Energy level" />
                            </div>
                            <TextareaInput name="notes" label="Notes" rows={2} defaultValue={log?.notes ?? ""} placeholder="Optional" />
                            <div className="flex justify-end gap-2 pt-1">
                                <Button color="secondary" onClick={() => onOpenChange(false)}>
                                    Cancel
                                </Button>
                                <SubmitButton color="primary">{log ? "Save" : "Log"}</SubmitButton>
                            </div>
                        </form>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

/**
 * Full-CRUD social battery: 30-day chart + a list of logs with add/edit/delete.
 * One row per day (unique constraint) — editing the same date updates it.
 */
export function BatteryManager({
    today,
    series,
    logs,
    saveAction,
    deleteAction,
}: {
    today: number | null;
    series: { date: string; energy: number | null }[];
    logs: BatteryLog[];
    saveAction: Action;
    deleteAction: Action;
}) {
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<BatteryLog | null>(null);
    const { confirm, dialog } = useConfirm();
    const data = series.map((d) => ({ label: formatDateShort(d.date), energy: d.energy }));

    async function remove(log: BatteryLog) {
        const fd = new FormData();
        fd.set("id", log.id);
        try {
            await deleteAction(fd);
            toast.success("Log deleted");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to delete");
        }
    }

    return (
        <Card>
            <CardHeader
                title={
                    <span className="inline-flex items-center gap-2">
                        <BatteryFull className="size-5 text-fg-brand-primary" aria-hidden="true" /> Social battery
                    </span>
                }
                action={
                    <Button color="primary" size="sm" iconLeading={Plus} onClick={() => setAdding(true)}>
                        {today != null ? "Log" : "Log today"}
                    </Button>
                }
            />
            <CardBody className="flex flex-col gap-4">
                <div>
                    <p className="mb-2 text-xs font-medium text-tertiary">Last 30 days</p>
                    <ResponsiveContainer width="100%" height={140}>
                        <AreaChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                            <defs>
                                <linearGradient id="socialBatteryFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-fg-brand-primary)" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="var(--color-fg-brand-primary)" stopOpacity={0.04} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" />
                            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} fontSize={11} interval="preserveStartEnd" minTickGap={32} tick={{ fill: "var(--color-text-tertiary)" }} />
                            <YAxis tickLine={false} axisLine={false} width={20} domain={[0, 10]} fontSize={11} tick={{ fill: "var(--color-text-tertiary)" }} />
                            <Tooltip cursor={{ stroke: "var(--color-border-secondary)" }} contentStyle={tooltipStyle} />
                            <Area dataKey="energy" type="monotone" connectNulls fill="url(#socialBatteryFill)" stroke="var(--color-fg-brand-primary)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                <div>
                    <p className="mb-2 text-xs font-medium text-tertiary">Recent logs</p>
                    {logs.length === 0 ? (
                        <EmptyHint>No battery logs yet.</EmptyHint>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {logs.map((log) => (
                                <li key={log.id} className="group flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                                    <span className="w-14 shrink-0 text-xs text-tertiary">{formatDateShort(log.date)}</span>
                                    <Badge size="sm" color={batteryColor(log.energyLevel)}>
                                        {log.energyLevel}
                                    </Badge>
                                    <span className="min-w-0 flex-1 truncate text-sm text-secondary">{log.notes || ""}</span>
                                    <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
                                        <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setEditing(log)} aria-label="Edit log" />
                                        <Button color="tertiary-destructive" size="sm" iconLeading={Trash01} aria-label="Delete log" onClick={() => confirm({ title: "Delete log?", confirmLabel: "Delete", onConfirm: () => remove(log) })} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </CardBody>

            <LogDialog open={adding} onOpenChange={setAdding} onSubmit={saveAction} />
            <LogDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} log={editing ?? undefined} onSubmit={saveAction} />
            {dialog}
        </Card>
    );
}
