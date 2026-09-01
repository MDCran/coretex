// @ts-nocheck


import { formatCurrency } from "../../personal/personal-ui";
import { toast } from "sonner";
import { Button } from "react-aria-components";
import { useState, useMemo } from "react";
import { formatDate } from "../../personal/personal-ui";
import { RefreshCw01, Plus, Lightbulb02, CheckCircle, XClose, SearchRefraction, Edit01, Trash02 } from "@untitledui/icons";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Badge } from "@/components/base/badges/badges";
import { BadgeColors } from "@/components/base/badges/badge-types";
import { Card, EmptyRow, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader, Stat, TableCard } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";

export interface SubRow {
    id: string;
    name: string | null;
    merchant: string;
    cadence: string;
    amount: number;
    status: string;
    startedOn: string | null;
    nextChargeOn: string | null;
    notes: string | null;
    transactionCount: number;
}

const CADENCES = [
    { value: "MONTHLY", label: "Monthly" },
    { value: "YEARLY", label: "Yearly" },
    { value: "WEEKLY", label: "Weekly" },
    { value: "OTHER", label: "Other" },
];
const STATUSES = [
    { value: "ACTIVE", label: "Active" },
    { value: "PAUSED", label: "Paused" },
    { value: "CANCELLED", label: "Cancelled" },
];

const statusColor: Record<string, BadgeColors> = { ACTIVE: "success", PAUSED: "warning", CANCELLED: "gray" };
const cadenceLabel = (c: string) => CADENCES.find((x) => x.value === c)?.label ?? c;

export function SubscriptionsClient({
    subscriptions,
    lastScanAt,
}: {
    subscriptions: SubRow[];
    lastScanAt?: string | null;
}) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<SubRow | null>(null);
    const [proposals, setProposals] = useState<DetectedSubscription[]>([]);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [scanning, setScanning] = useState(false);

    async function onScan() {
        setScanning(true);
        try {
            const found = await runSubscriptionScan();
            setProposals(found);
            if (found.length > 0) {
                toast.success(`${found.length} potential subscription${found.length === 1 ? "" : "s"} detected`);
            } else {
                toast.info("No new subscriptions detected");
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Scan failed");
        } finally {
            setScanning(false);
        }
    }

    const monthlyTotal = useMemo(
        () => subscriptions.filter((s) => s.status === "ACTIVE").reduce((sum, s) => sum + monthlyFromCadence(s.amount, s.cadence), 0),
        [subscriptions],
    );

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(s: SubRow) {
        setEditing(s);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateSubscription(fd);
            else await createSubscription(fd);
            toast.success(editing ? "Subscription updated" : "Subscription added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteSubscription(fd);
            toast.success("Deleted");
        } catch {
            toast.error("Failed");
        }
    }

    async function onAccept(p: DetectedSubscription) {
        setBusyKey(p.key);
        try {
            await acceptDetectedSubscription({
                key: p.key,
                merchant: p.merchant,
                cadence: p.cadence,
                amount: p.amount,
                nextChargeOn: p.nextChargeOn,
                transactionIds: p.transactionIds,
            });
            setProposals((ps) => ps.filter((x) => x.key !== p.key));
            toast.success(`Added ${p.merchant} · linked ${p.evidenceCount} transactions`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to add");
        } finally {
            setBusyKey(null);
        }
    }
    async function onDismiss(p: DetectedSubscription) {
        setBusyKey(p.key);
        try {
            await dismissDetectedSubscription({ key: p.key, merchant: p.merchant });
            setProposals((ps) => ps.filter((x) => x.key !== p.key));
            toast.success("Dismissed");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to dismiss");
        } finally {
            setBusyKey(null);
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Subscriptions"
                description="Recurring charges normalized to a monthly cost."
                action={
                    <div className="flex flex-wrap gap-2">
                        <Button size="md" color="secondary" iconLeading={RefreshCw01} onClick={onScan} isLoading={scanning}>
                            Scan for subscriptions
                        </Button>
                        <Button size="md" iconLeading={Plus} onClick={openCreate}>
                            Add subscription
                        </Button>
                    </div>
                }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Monthly cost (active)" value={formatCurrency(monthlyTotal)} />
                <Stat label="Yearly cost (active)" value={formatCurrency(monthlyTotal * 12)} />
                <Stat
                    label="Active subscriptions"
                    value={subscriptions.filter((s) => s.status === "ACTIVE").length}
                    sub={lastScanAt ? `Last scan ${formatDate(lastScanAt)}` : "Run scan to detect recurring charges"}
                />
            </div>

            {/* Detected recurring charges */}
            {proposals.length > 0 && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <FeaturedIcon icon={Lightbulb02} color="brand" theme="light" size="sm" />
                        <div>
                            <h3 className="text-md font-semibold text-primary">Detected from your transactions</h3>
                            <p className="text-sm text-tertiary">Recurring charges we found. Accept to track them and link their transactions, or dismiss.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {proposals.map((p) => (
                            <Card key={p.key} className="flex flex-col gap-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-primary">{p.merchant}</p>
                                        <p className="text-xs text-tertiary">
                                            ~{formatCurrency(p.amount)} · {cadenceLabel(p.cadence)}
                                        </p>
                                    </div>
                                    <Badge size="sm" color="brand">
                                        {p.evidenceCount}× seen
                                    </Badge>
                                </div>
                                <div className="flex flex-col gap-1 text-xs text-tertiary">
                                    <span>Last seen {formatDate(p.lastSeen)}</span>
                                    <span>Est. next charge {formatDate(p.nextChargeOn)}</span>
                                </div>
                                <div className="mt-auto flex gap-2">
                                    <Button
                                        size="sm"
                                        iconLeading={CheckCircle}
                                        className="flex-1"
                                        isLoading={busyKey === p.key}
                                        onClick={() => onAccept(p)}
                                    >
                                        Accept
                                    </Button>
                                    <Button size="sm" color="secondary" iconLeading={XClose} isDisabled={busyKey === p.key} onClick={() => onDismiss(p)} aria-label="Dismiss" />
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>
            )}
            {proposals.length === 0 && (
                <Card className="flex items-center gap-3 py-4">
                    <FeaturedIcon icon={SearchRefraction} color="gray" theme="modern" size="sm" />
                    <p className="text-sm text-tertiary">
                        No new recurring charges detected. As you import statements and transactions, repeated same-merchant charges will be suggested here automatically.
                    </p>
                </Card>
            )}

            <TableCard minWidth={820}>
                <thead>
                    <tr className="border-b border-secondary text-left text-tertiary">
                        <th className="px-5 py-3 font-medium">Service</th>
                        <th className="px-5 py-3 font-medium">Cadence</th>
                        <th className="px-5 py-3 text-right font-medium">Amount</th>
                        <th className="px-5 py-3 text-right font-medium">Monthly</th>
                        <th className="px-5 py-3 font-medium">Next charge</th>
                        <th className="px-5 py-3 font-medium">Linked</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3" />
                    </tr>
                </thead>
                <tbody>
                    {subscriptions.length === 0 && (
                        <EmptyRow
                            colSpan={8}
                            icon={RefreshCw01}
                            title="See every recurring charge in one place"
                            description="Add a subscription manually, or scan your transactions to surface recurring charges automatically — then watch your true monthly cost add up."
                            action={
                                <>
                                    <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                        Add subscription
                                    </Button>
                                    <Button size="sm" color="secondary" iconLeading={RefreshCw01} onClick={onScan} isLoading={scanning}>
                                        Scan transactions
                                    </Button>
                                </>
                            }
                        />
                    )}
                    {subscriptions.map((s) => (
                        <tr key={s.id} className="border-b border-secondary last:border-0">
                            <td className="px-5 py-3">
                                <p className="font-medium text-primary">{s.name || s.merchant}</p>
                                {s.name && <p className="text-xs text-tertiary">{s.merchant}</p>}
                            </td>
                            <td className="px-5 py-3 text-secondary">{cadenceLabel(s.cadence)}</td>
                            <td className="px-5 py-3 text-right text-secondary">{formatCurrency(s.amount)}</td>
                            <td className="px-5 py-3 text-right font-medium text-primary">{formatCurrency(monthlyFromCadence(s.amount, s.cadence))}</td>
                            <td className="px-5 py-3 text-tertiary">{formatDate(s.nextChargeOn)}</td>
                            <td className="px-5 py-3">
                                {s.transactionCount > 0 ? (
                                    <a href="#">
                                        {s.transactionCount} {s.transactionCount === 1 ? "Transaction" : "Transactions"}
                                    </a>
                                ) : (
                                    <span className="text-sm text-tertiary">—</span>
                                )}
                            </td>
                            <td className="px-5 py-3">
                                <Badge size="sm" color={statusColor[s.status] ?? "gray"}>
                                    {STATUSES.find((x) => x.value === s.status)?.label ?? s.status}
                                </Badge>
                            </td>
                            <td className="px-5 py-3">
                                <div className="flex justify-end gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(s)} aria-label="Edit" />
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(s.id)} aria-label="Delete" />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </TableCard>

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit subscription" : "Add subscription"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Merchant" htmlFor="merchant">
                        <NativeInput id="merchant" name="merchant" required defaultValue={editing?.merchant ?? ""} placeholder="e.g. Netflix" />
                    </Field>
                    <Field label="Display name (optional)" htmlFor="name">
                        <NativeInput id="name" name="name" defaultValue={editing?.name ?? ""} />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Amount" htmlFor="amount">
                            <NativeInput id="amount" name="amount" type="number" step="0.01" required defaultValue={editing?.amount ?? ""} />
                        </Field>
                        <Field label="Cadence" htmlFor="cadence">
                            <NativeSelect id="cadence" name="cadence" defaultValue={editing?.cadence ?? "MONTHLY"}>
                                {CADENCES.map((c) => (
                                    <option key={c.value} value={c.value}>
                                        {c.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <FormDateInput name="startedOn" label="Started on" defaultValue={editing?.startedOn ? editing.startedOn.slice(0, 10) : ""} />
                        <FormDateInput name="nextChargeOn" label="Next charge" defaultValue={editing?.nextChargeOn ? editing.nextChargeOn.slice(0, 10) : ""} />
                    </div>
                    <Field label="Status" htmlFor="status">
                        <NativeSelect id="status" name="status" defaultValue={editing?.status ?? "ACTIVE"}>
                            {STATUSES.map((s) => (
                                <option key={s.value} value={s.value}>
                                    {s.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
