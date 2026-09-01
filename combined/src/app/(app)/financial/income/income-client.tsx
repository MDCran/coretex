"use client";

import { useMemo, useState } from "react";
import { Edit01, Plus, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Select } from "@/components/base/select/select";
import { createIncomeEntry, createIncomeStream, deleteIncomeEntry, deleteIncomeStream, updateIncomeStream } from "@/lib/actions/financial-income";
import { formatCurrency, formatDate } from "@/lib/financial/format";
import { formatMonthYear } from "@/lib/dates";
import { AmountBadge } from "../_components/amount-badge";
import { BloomCard, Card, EmptyRow, EmptyState, Field, NativeInput, NativeTextarea, SectionHeader, TableCard } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { TrendChart, type TrendPoint } from "../_components/trend-chart";

export interface StreamRow {
    id: string;
    name: string;
    kind: string | null;
    notes: string | null;
    archived: boolean;
}
export interface EntryRow {
    id: string;
    streamId: string;
    amount: number;
    receivedAt: string;
    notes: string | null;
}

function toLocalInput(iso: string) {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function IncomeClient({ streams, entries }: { streams: StreamRow[]; entries: EntryRow[] }) {
    const [streamOpen, setStreamOpen] = useState(false);
    const [editingStream, setEditingStream] = useState<StreamRow | null>(null);
    const [entryOpen, setEntryOpen] = useState(false);
    const [entryStreamId, setEntryStreamId] = useState("");
    const { confirm, dialog } = useConfirm();

    const activeStreams = streams.filter((s) => !s.archived);
    const streamName = (id: string) => streams.find((s) => s.id === id)?.name ?? "—";

    const chartData: TrendPoint[] = useMemo(() => {
        const byMonth = new Map<string, number>();
        for (const e of entries) {
            const key = e.receivedAt.slice(0, 7);
            byMonth.set(key, (byMonth.get(key) ?? 0) + e.amount);
        }
        return Array.from(byMonth.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-12)
            .map(([key, value]) => ({
                label: formatMonthYear(key + "-01T12:00:00Z"),
                Income: value,
            }));
    }, [entries]);

    const perStreamChart = useMemo(() => {
        const map = new Map<string, Map<string, number>>();
        for (const e of entries) {
            const month = e.receivedAt.slice(0, 7);
            const sm = map.get(e.streamId) ?? new Map<string, number>();
            sm.set(month, (sm.get(month) ?? 0) + e.amount);
            map.set(e.streamId, sm);
        }
        const out: Record<string, TrendPoint[]> = {};
        for (const [streamId, months] of map.entries()) {
            out[streamId] = [...months.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .slice(-12)
                .map(([key, value]) => ({ label: formatMonthYear(key + "-01T12:00:00Z"), Income: value }));
        }
        return out;
    }, [entries]);

    const thisMonth = useMemo(() => {
        const key = new Date().toISOString().slice(0, 7);
        return entries.filter((e) => e.receivedAt.slice(0, 7) === key).reduce((s, e) => s + e.amount, 0);
    }, [entries]);

    function openLogForStream(streamId: string) {
        setEntryStreamId(streamId);
        setEntryOpen(true);
    }

    async function onStreamSubmit(fd: FormData) {
        try {
            if (editingStream) await updateIncomeStream(fd);
            else await createIncomeStream(fd);
            toast.success(editingStream ? "Stream updated" : "Stream added");
            setStreamOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onEntrySubmit(fd: FormData) {
        try {
            await createIncomeEntry(fd);
            toast.success("Income logged");
            setEntryOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    function onDeleteStream(id: string) {
        confirm({
            title: "Delete this stream and all its entries?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", id);
                try {
                    await deleteIncomeStream(fd);
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed");
                }
            },
        });
    }
    async function onDeleteEntry(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteIncomeEntry(fd);
            toast.success("Deleted");
        } catch {
            toast.error("Failed");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Income"
                description="Income streams and logged earnings."
                action={
                    <div className="flex gap-2">
                        <Button
                            size="md"
                            color="secondary"
                            iconLeading={Plus}
                            onClick={() => {
                                setEditingStream(null);
                                setStreamOpen(true);
                            }}
                        >
                            Add stream
                        </Button>
                        <Button
                            size="md"
                            iconLeading={Plus}
                            isDisabled={activeStreams.length === 0}
                            onClick={() => openLogForStream(activeStreams[0]?.id ?? "")}
                        >
                            Log income
                        </Button>
                    </div>
                }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <BloomCard bloom="success">
                    <p className="text-sm text-tertiary">This month</p>
                    <p className="text-display-xs font-semibold text-success-primary">{formatCurrency(thisMonth)}</p>
                    <p className="text-xs text-tertiary">USD</p>
                </BloomCard>
                <BloomCard bloom="brand">
                    <p className="text-sm text-tertiary">Active streams</p>
                    <p className="text-display-xs font-semibold text-primary">{activeStreams.length}</p>
                </BloomCard>
                <BloomCard bloom="brand">
                    <p className="text-sm text-tertiary">Entries logged</p>
                    <p className="text-display-xs font-semibold text-primary">{entries.length}</p>
                </BloomCard>
            </div>

            <BloomCard bloom="success">
                <h3 className="mb-4 text-md font-semibold text-primary">Monthly income (all streams)</h3>
                <TrendChart data={chartData} series={[{ key: "Income", name: "Income (USD)" }]} type="bar" money emptyLabel="No income logged yet" />
            </BloomCard>

            <Card className="flex flex-col gap-3 p-0">
                <h3 className="border-b border-secondary px-5 py-4 text-md font-semibold text-primary">Income streams</h3>
                <div className="flex flex-col gap-3 px-5 pb-5">
                    {streams.length === 0 && (
                        <EmptyState
                            icon={Plus}
                            theme="modern"
                            color="gray"
                            title="Add your first income stream"
                            description="Salary, freelance, dividends and side hustles — group earnings by stream to see what's really paying you."
                            action={
                                <Button
                                    size="sm"
                                    iconLeading={Plus}
                                    onClick={() => {
                                        setEditingStream(null);
                                        setStreamOpen(true);
                                    }}
                                >
                                    Add stream
                                </Button>
                            }
                        />
                    )}
                    {streams.map((s) => (
                        <div key={s.id} className="flex flex-col gap-2 rounded-xl p-3 ring-1 ring-secondary ring-inset">
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-primary">{s.name}</p>
                                    {s.kind && <p className="text-xs text-tertiary">{s.kind}</p>}
                                </div>
                                {s.archived && (
                                    <Badge size="sm" type="modern" color="gray">
                                        Archived
                                    </Badge>
                                )}
                                <Button size="sm" color="primary" iconLeading={Plus} onClick={() => openLogForStream(s.id)}>
                                    Log
                                </Button>
                                <Button
                                    size="sm"
                                    color="tertiary"
                                    iconLeading={Edit01}
                                    onClick={() => {
                                        setEditingStream(s);
                                        setStreamOpen(true);
                                    }}
                                    aria-label="Edit"
                                />
                                <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDeleteStream(s.id)} aria-label="Delete" />
                            </div>
                            {(perStreamChart[s.id]?.length ?? 0) > 0 && (
                                <TrendChart data={perStreamChart[s.id]!} series={[{ key: "Income", name: "Income (USD)" }]} type="area" height={80} money emptyLabel="" />
                            )}
                        </div>
                    ))}
                </div>
            </Card>

            <TableCard minWidth={560}>
                <thead>
                    <tr className="border-b border-secondary text-left text-tertiary">
                        <th className="px-5 py-3 font-medium">Date</th>
                        <th className="px-5 py-3 font-medium">Stream</th>
                        <th className="px-5 py-3 text-right font-medium">Amount</th>
                        <th className="px-5 py-3 font-medium">Notes</th>
                        <th className="px-5 py-3" />
                    </tr>
                </thead>
                <tbody>
                    {entries.length === 0 && (
                        <EmptyRow
                            colSpan={5}
                            icon={Plus}
                            title="No income logged yet"
                            description={activeStreams.length === 0 ? "Add a stream above, then log your earnings to chart income over time." : "Log a paycheck or payout to start charting your income over time."}
                            action={
                                activeStreams.length > 0 ? (
                                    <Button size="sm" iconLeading={Plus} onClick={() => openLogForStream(activeStreams[0]?.id ?? "")}>
                                        Log income
                                    </Button>
                                ) : undefined
                            }
                        />
                    )}
                    {entries.map((e) => (
                        <tr key={e.id} className="border-b border-secondary last:border-0">
                            <td className="px-5 py-3 text-tertiary">{formatDate(e.receivedAt)}</td>
                            <td className="px-5 py-3">
                                <Badge size="sm" type="modern" color="gray">
                                    {streamName(e.streamId)}
                                </Badge>
                            </td>
                            <td className="px-5 py-3 text-right">
                                <AmountBadge amount={e.amount} />
                            </td>
                            <td className="max-w-[200px] truncate px-5 py-3 text-tertiary">{e.notes}</td>
                            <td className="px-5 py-3">
                                <div className="flex justify-end">
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDeleteEntry(e.id)} aria-label="Delete" />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </TableCard>

            <FormModal isOpen={streamOpen} onOpenChange={setStreamOpen} title={editingStream ? "Edit stream" : "Add income stream"}>
                <form action={onStreamSubmit} className="flex flex-col gap-4">
                    {editingStream && <input type="hidden" name="id" value={editingStream.id} />}
                    <Field label="Name" htmlFor="name">
                        <NativeInput id="name" name="name" required defaultValue={editingStream?.name ?? ""} placeholder="e.g. Salary" />
                    </Field>
                    <Field label="Kind" htmlFor="kind">
                        <NativeInput id="kind" name="kind" defaultValue={editingStream?.kind ?? ""} placeholder="e.g. W2, freelance, dividends" />
                    </Field>
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editingStream?.notes ?? ""} />
                    </Field>
                    {editingStream && <Checkbox name="archived" defaultSelected={editingStream.archived} label="Archived" />}
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setStreamOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editingStream ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            <FormModal isOpen={entryOpen} onOpenChange={setEntryOpen} title="Log income">
                <form action={onEntrySubmit} className="flex flex-col gap-4">
                    <Field label="Stream">
                        <input type="hidden" name="streamId" value={entryStreamId} />
                        <Select
                            selectedKey={entryStreamId}
                            onSelectionChange={(k) => k && setEntryStreamId(String(k))}
                            items={activeStreams.map((s) => ({ id: s.id, label: s.name }))}
                            placeholder="Select stream"
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Amount" htmlFor="amount">
                            <NativeInput id="amount" name="amount" type="number" step="0.01" required />
                        </Field>
                        <FormDateInput name="receivedAt" label="Received at" variant="datetime" defaultValue={toLocalInput(new Date().toISOString())} />
                    </div>
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setEntryOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Log</Button>
                    </div>
                </form>
            </FormModal>

            {dialog}
        </div>
    );
}
