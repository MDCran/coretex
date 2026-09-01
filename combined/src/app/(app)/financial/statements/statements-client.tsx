"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bank, Briefcase01, CreditCard02, Download01, Edit01, Lightbulb02, Link03, RefreshCw01, Trash02, UploadCloud02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import type { BadgeColors } from "@/components/base/badges/badge-types";
import { Button } from "@/components/base/buttons/button";
import {
    assignStatementOwner,
    deleteStatement,
    renameStatement,
    reprocessStatement,
    suggestStatementOwner,
    uploadStatement,
} from "@/lib/actions/financial-statements";
import { formatCurrency, formatDate } from "@/lib/financial/format";
import { formatRelative } from "@/lib/dates";
import { DeltaBadge } from "../_components/delta-badge";
import { BloomCard, Card, EmptyRow, Field, NativeInput, NativeSelect, SectionHeader } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";
import { ControlledDateInput, FormDateInput } from "@/components/base/input/form-date-input";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";

export interface StatementRow {
    id: string;
    fileName: string;
    downloadUrl: string;
    ownerId: string | null;
    targetLabel: string | null;
    targetKind: "account" | "card" | "brokerage" | null;
    periodStart: string | null;
    periodEnd: string | null;
    endingBalance: number | null;
    transactionCount: number;
    processingStatus: string;
    processingError: string | null;
    aiExtractedAt: string | null;
}

interface Opt {
    id: string;
    label: string;
}

const statusColor: Record<string, BadgeColors> = { PENDING: "gray", PROCESSING: "warning", DONE: "success", FAILED: "error" };

// Sort order for groups: accounts → cards → brokerage → unlinked.
const KIND_ORDER: Record<string, number> = { account: 0, card: 1, brokerage: 2, none: 3 };

function anchorId(kind: string | null, ownerId: string | null) {
    return `stmt-group-${kind ?? "none"}-${ownerId ?? "none"}`;
}

function OwnerChip({ row }: { row: StatementRow }) {
    if (!row.ownerId || !row.targetLabel) return <span className="text-xs text-tertiary">Unlinked</span>;
    const href =
        row.targetKind === "account"
            ? `/financial/accounts/${row.ownerId}`
            : row.targetKind === "card"
              ? `/financial/cards/${row.ownerId}`
              : row.targetKind === "brokerage"
                ? `/financial/brokerage/${row.ownerId}`
                : null;
    if (!href) return <span className="text-xs text-tertiary">{row.targetLabel}</span>;
    const Icon = row.targetKind === "account" ? Bank : row.targetKind === "card" ? CreditCard02 : Briefcase01;
    return (
        <Link href={href}>
            <Badge size="sm" type="modern" color="gray" className="gap-1.5 transition hover:bg-secondary_hover">
                <Icon aria-hidden="true" className="size-3.5 text-fg-quaternary" />
                {row.targetLabel}
            </Badge>
        </Link>
    );
}

function balanceDelta(rows: StatementRow[], current: StatementRow): number | null {
    const curEnd = current.periodEnd ?? current.periodStart;
    if (current.endingBalance == null || !curEnd) return null;
    const prior = rows
        .filter((s) => {
            if (s.id === current.id || s.endingBalance == null) return false;
            const end = s.periodEnd ?? s.periodStart;
            return end != null && end < curEnd;
        })
        .sort((a, b) => (b.periodEnd ?? b.periodStart ?? "").localeCompare(a.periodEnd ?? a.periodStart ?? ""))[0];
    if (!prior?.endingBalance) return null;
    return current.endingBalance - prior.endingBalance;
}

export function StatementsClient({
    statements,
    accounts,
    cards,
    brokerages,
    aiConfigured,
}: {
    statements: StatementRow[];
    accounts: Opt[];
    cards: Opt[];
    brokerages: Opt[];
    aiConfigured: boolean;
}) {
    const [uploadOpen, setUploadOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const { confirm, dialog } = useConfirm();

    // Rename modal
    const [renaming, setRenaming] = useState<StatementRow | null>(null);

    // Assign / suggest modal
    const [assigning, setAssigning] = useState<StatementRow | null>(null);
    const [assignOwner, setAssignOwner] = useState("");
    const [suggesting, setSuggesting] = useState(false);
    const [suggestion, setSuggestion] = useState<{ label: string | null; reason: string; confidence: string } | null>(null);

    // Find statement filter
    const [findAccount, setFindAccount] = useState("");
    const [findFrom, setFindFrom] = useState("");
    const [findTo, setFindTo] = useState("");

    const ownerOptions = useMemo(
        () => [
            ...accounts.map((a) => ({ value: `account:${a.id}`, label: `Account: ${a.label}` })),
            ...cards.map((c) => ({ value: `card:${c.id}`, label: `Card: ${c.label}` })),
            ...brokerages.map((b) => ({ value: `brokerage:${b.id}`, label: `Brokerage: ${b.label}` })),
        ],
        [accounts, cards, brokerages],
    );

    const filtered = useMemo(() => {
        return statements.filter((s) => {
            if (findAccount && `${s.targetKind}:${s.ownerId}` !== findAccount) return false;
            const ps = s.periodStart ? s.periodStart.slice(0, 10) : null;
            const pe = s.periodEnd ? s.periodEnd.slice(0, 10) : null;
            // The statement's covered period is [ps..pe] (fall back to whichever exists).
            const lo = ps ?? pe;
            const hi = pe ?? ps;
            // Require overlap with the [findFrom..findTo] window.
            if (findFrom && hi && hi < findFrom) return false;
            if (findTo && lo && lo > findTo) return false;
            return true;
        });
    }, [statements, findAccount, findFrom, findTo]);

    // Group by owner; sort groups by kind then label, rows by periodEnd desc.
    const groups = useMemo(() => {
        const byOwner = new Map<string, { label: string; kind: StatementRow["targetKind"]; ownerId: string | null; rows: StatementRow[] }>();
        for (const s of filtered) {
            const key = `${s.targetKind}:${s.ownerId ?? "none"}`;
            if (!byOwner.has(key)) byOwner.set(key, { label: s.targetLabel ?? "Unlinked", kind: s.targetKind, ownerId: s.ownerId, rows: [] });
            byOwner.get(key)!.rows.push(s);
        }
        return [...byOwner.values()]
            .map((g) => ({ ...g, rows: g.rows.sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? "")) }))
            .sort((a, b) => {
                const ko = (KIND_ORDER[a.kind ?? "none"] ?? 3) - (KIND_ORDER[b.kind ?? "none"] ?? 3);
                return ko !== 0 ? ko : a.label.localeCompare(b.label);
            });
    }, [filtered]);

    function scrollToGroup(value: string) {
        if (!value) return;
        const [kind, ownerId] = value.split(":");
        const el = document.getElementById(anchorId(kind, ownerId));
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function onUpload(fd: FormData) {
        const owner = String(fd.get("owner") ?? "");
        if (owner) {
            const [kind, id] = owner.split(":");
            if (kind === "account") fd.set("finAccountId", id);
            if (kind === "card") fd.set("creditCardId", id);
            if (kind === "brokerage") fd.set("brokerageAccountId", id);
        }
        setUploading(true);
        try {
            await uploadStatement(fd);
            toast.success(aiConfigured ? "Statement uploaded — extracting with AI…" : "Statement uploaded");
            setUploadOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Upload failed");
        } finally {
            setUploading(false);
        }
    }
    async function onReprocess(id: string) {
        if (!aiConfigured) {
            toast.error("Add ANTHROPIC_API_KEY to enable AI extraction.");
            return;
        }
        setBusyId(id);
        try {
            const fd = new FormData();
            fd.set("id", id);
            const res = await reprocessStatement(fd);
            if (res.duplicate) toast.warning(res.error ?? "Duplicate statement");
            else if (res.status === "DONE") toast.success(`Extracted ${res.inserted} transactions${res.skipped ? `, skipped ${res.skipped}` : ""}`);
            else toast.error(res.error ?? "Extraction failed");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Extraction failed");
        } finally {
            setBusyId(null);
        }
    }
    function onDelete(id: string) {
        confirm({
            title: "Delete statement?",
            description: "This deletes the statement and its extracted transactions.",
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", id);
                try {
                    await deleteStatement(fd);
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed");
                }
            },
        });
    }

    async function onRename(fd: FormData) {
        try {
            await renameStatement(fd);
            toast.success("Renamed");
            setRenaming(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        }
    }

    function openAssign(row: StatementRow) {
        setAssigning(row);
        setAssignOwner(row.ownerId ? `${row.targetKind}:${row.ownerId}` : "");
        setSuggestion(null);
    }
    async function onSuggest() {
        if (!assigning) return;
        setSuggesting(true);
        try {
            const fd = new FormData();
            fd.set("id", assigning.id);
            const res = await suggestStatementOwner(fd);
            if (res.ownerKind === "none" || !res.ownerId) {
                setSuggestion({ label: null, reason: res.reason, confidence: res.confidence });
                toast.info("No confident match found");
            } else {
                setAssignOwner(`${res.ownerKind}:${res.ownerId}`);
                setSuggestion({ label: res.label, reason: res.reason, confidence: res.confidence });
                toast.success(`Suggested: ${res.label}`);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        } finally {
            setSuggesting(false);
        }
    }
    async function onApplyAssign() {
        if (!assigning) return;
        try {
            const fd = new FormData();
            fd.set("id", assigning.id);
            fd.set("owner", assignOwner);
            await assignStatementOwner(fd);
            toast.success("Statement linked");
            setAssigning(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Statements"
                description="Grouped by account, then cards and brokerage — newest first."
                action={
                    <Button size="md" iconLeading={UploadCloud02} onClick={() => setUploadOpen(true)}>
                        Upload statement
                    </Button>
                }
            />

            {/* Toolbar: Go to account + Find statement */}
            <Card className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Go to account" hint="Jump to a group below.">
                        <NativeSelect defaultValue="" onChange={(e) => scrollToGroup(e.target.value)}>
                            <option value="">Select…</option>
                            {ownerOptions.map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                </div>
                <div className="flex flex-col gap-3 border-t border-secondary pt-4">
                    <p className="text-sm font-medium text-secondary">Find statement</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <Field label="Account">
                            <NativeSelect value={findAccount} onChange={(e) => setFindAccount(e.target.value)}>
                                <option value="">All</option>
                                {ownerOptions.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="From">
                            <ControlledDateInput variant="date" value={findFrom || null} onChange={setFindFrom} className="w-full" />
                        </Field>
                        <Field label="To">
                            <ControlledDateInput variant="date" value={findTo || null} onChange={setFindTo} className="w-full" />
                        </Field>
                        <div className="flex items-end">
                            {(findAccount || findFrom || findTo) && (
                                <Button size="sm" color="link-gray" onClick={() => { setFindAccount(""); setFindFrom(""); setFindTo(""); }}>
                                    Clear
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </Card>

            <p className="text-xs text-tertiary">
                {aiConfigured
                    ? "Uploaded PDFs are parsed with AI to extract the period, balance and transactions, and the file is auto-named. Use “Suggest account” to link unowned statements."
                    : "Add ANTHROPIC_API_KEY to enable AI extraction. Until then, set the period and ending balance manually when uploading."}
            </p>

            {groups.length === 0 ? (
                <Card>
                    <p className="py-8 text-center text-tertiary">{statements.length === 0 ? "No statements uploaded." : "No statements match the filter."}</p>
                </Card>
            ) : (
                groups.map((g) => (
                    <BloomCard key={`${g.kind}:${g.ownerId}`} id={anchorId(g.kind, g.ownerId)} bloom="brand" className="flex scroll-mt-24 flex-col gap-4 p-0">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-secondary px-5 py-4">
                            <div className="flex items-center gap-2">
                                <h3 className="text-md font-semibold text-primary">{g.label}</h3>
                                {g.kind && (
                                    <Badge size="sm" type="modern" color="gray">
                                        {g.kind === "account" ? "Account" : g.kind === "card" ? "Card" : "Brokerage"}
                                    </Badge>
                                )}
                            </div>
                            <span className="text-xs text-tertiary">
                                {g.rows.length} statement{g.rows.length === 1 ? "" : "s"}
                            </span>
                        </div>
                        <div className="overflow-x-auto px-5 pb-5">
                            <table className="w-full min-w-[820px] text-sm">
                                <tbody>
                                    {g.rows.length === 0 && <EmptyRow colSpan={6} />}
                                    {g.rows.map((s) => {
                                        const isDup = s.processingStatus === "FAILED" && (s.processingError ?? "").startsWith("Duplicate");
                                        return (
                                            <tr key={s.id} className="border-b border-secondary last:border-0">
                                                <td className="py-3 pr-4">
                                                    <p className="font-medium text-primary">{s.fileName}</p>
                                                    {!s.ownerId && (
                                                        <span className="mt-0.5 inline-block">
                                                            <OwnerChip row={s} />
                                                        </span>
                                                    )}
                                                    {s.aiExtractedAt && (
                                                        <p className="mt-0.5 text-xs text-tertiary">
                                                            Extracted {formatRelative(s.aiExtractedAt)}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-tertiary">
                                                    {s.periodStart || s.periodEnd ? `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}` : "—"}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    {s.endingBalance != null ? (
                                                        <div className="flex flex-col items-end gap-1">
                                                            <span className="font-medium text-primary">{formatCurrency(s.endingBalance)} USD</span>
                                                            <DeltaBadge delta={balanceDelta(g.rows, s)} format={formatCurrency} precision={0} evenLabel="No change" />
                                                        </div>
                                                    ) : (
                                                        "—"
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-tertiary">
                                                    {s.transactionCount > 0 ? `${s.transactionCount} ${s.transactionCount === 1 ? "Transaction" : "Transactions"}` : "—"}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {isDup ? (
                                                        <Badge size="sm" type="color" color="warning">
                                                            Duplicate
                                                        </Badge>
                                                    ) : (
                                                        <Badge size="sm" type="color" color={statusColor[s.processingStatus] ?? "gray"}>
                                                            {s.processingStatus === "DONE" ? "PROCESSED" : s.processingStatus}
                                                        </Badge>
                                                    )}
                                                </td>
                                                <td className="py-3 pl-4">
                                                    <div className="flex justify-end gap-1">
                                                        {!s.ownerId && (
                                                            <Button size="sm" color="tertiary" iconLeading={Lightbulb02} onClick={() => openAssign(s)} aria-label="Suggest account" />
                                                        )}
                                                        {s.ownerId && (
                                                            <Button size="sm" color="tertiary" iconLeading={Link03} onClick={() => openAssign(s)} aria-label="Change account" />
                                                        )}
                                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => setRenaming(s)} aria-label="Rename" />
                                                        <Button
                                                            size="sm"
                                                            color="tertiary"
                                                            iconLeading={RefreshCw01}
                                                            onClick={() => onReprocess(s.id)}
                                                            isLoading={busyId === s.id}
                                                            aria-label="Re-extract with AI"
                                                            title={s.aiExtractedAt ? `Re-extract with AI (last: ${formatRelative(s.aiExtractedAt)})` : "Extract with AI"}
                                                        />
                                                        <Button size="sm" color="tertiary" iconLeading={Download01} href={s.downloadUrl} target="_blank" aria-label="Download" />
                                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(s.id)} aria-label="Delete" />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </BloomCard>
                ))
            )}

            {/* Upload modal */}
            <FormModal isOpen={uploadOpen} onOpenChange={setUploadOpen} title="Upload statement">
                <form action={onUpload} className="flex flex-col gap-4">
                    <Field label="Owner" htmlFor="owner">
                        <NativeSelect id="owner" name="owner">
                            <option value="">— none (suggest later) —</option>
                            <optgroup label="Accounts">
                                {accounts.map((a) => (
                                    <option key={a.id} value={`account:${a.id}`}>
                                        {a.label}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label="Cards">
                                {cards.map((c) => (
                                    <option key={c.id} value={`card:${c.id}`}>
                                        {c.label}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label="Brokerage">
                                {brokerages.map((b) => (
                                    <option key={b.id} value={`brokerage:${b.id}`}>
                                        {b.label}
                                    </option>
                                ))}
                            </optgroup>
                        </NativeSelect>
                    </Field>
                    <Field label="File" htmlFor="file">
                        <FormFileUpload name="file" hint="PDF, image or any document up to 25 MB." />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <FormDateInput name="periodStart" label="Period start" />
                        <FormDateInput name="periodEnd" label="Period end" />
                    </div>
                    <Field label="Ending balance" htmlFor="endingBalance">
                        <NativeInput id="endingBalance" name="endingBalance" type="number" step="0.01" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setUploadOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" isLoading={uploading}>
                            Upload
                        </Button>
                    </div>
                </form>
            </FormModal>

            {/* Rename modal */}
            <FormModal isOpen={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)} title="Rename statement file">
                {renaming && (
                    <form action={onRename} className="flex flex-col gap-4">
                        <input type="hidden" name="id" value={renaming.id} />
                        <Field label="File name" htmlFor="fileName" hint="The extension is preserved automatically.">
                            <NativeInput id="fileName" name="fileName" defaultValue={renaming.fileName} required />
                        </Field>
                        <div className="flex justify-end gap-2 pt-2">
                            <Button color="secondary" type="button" onClick={() => setRenaming(null)}>
                                Cancel
                            </Button>
                            <Button type="submit">Save</Button>
                        </div>
                    </form>
                )}
            </FormModal>

            {/* Assign / suggest modal */}
            <FormModal isOpen={assigning !== null} onOpenChange={(o) => !o && setAssigning(null)} title="Link statement to account">
                {assigning && (
                    <div className="flex flex-col gap-4">
                        <Field label="Account / card">
                            <NativeSelect value={assignOwner} onChange={(e) => setAssignOwner(e.target.value)}>
                                <option value="">— none —</option>
                                <optgroup label="Accounts">
                                    {accounts.map((a) => (
                                        <option key={a.id} value={`account:${a.id}`}>
                                            {a.label}
                                        </option>
                                    ))}
                                </optgroup>
                                <optgroup label="Cards">
                                    {cards.map((c) => (
                                        <option key={c.id} value={`card:${c.id}`}>
                                            {c.label}
                                        </option>
                                    ))}
                                </optgroup>
                                <optgroup label="Brokerage">
                                    {brokerages.map((b) => (
                                        <option key={b.id} value={`brokerage:${b.id}`}>
                                            {b.label}
                                        </option>
                                    ))}
                                </optgroup>
                            </NativeSelect>
                        </Field>
                        {suggestion && (
                            <div className="rounded-lg bg-secondary px-3 py-2 text-xs text-tertiary">
                                {suggestion.label ? (
                                    <>
                                        <span className="font-medium text-secondary">Suggested: {suggestion.label}</span> ({suggestion.confidence}) — {suggestion.reason}
                                    </>
                                ) : (
                                    suggestion.reason
                                )}
                            </div>
                        )}
                        <div className="flex justify-between gap-2 pt-2">
                            <Button color="secondary" iconLeading={Lightbulb02} type="button" onClick={onSuggest} isLoading={suggesting}>
                                Suggest account
                            </Button>
                            <div className="flex gap-2">
                                <Button color="secondary" type="button" onClick={() => setAssigning(null)}>
                                    Cancel
                                </Button>
                                <Button type="button" onClick={onApplyAssign}>
                                    Link
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </FormModal>

            {dialog}
        </div>
    );
}
