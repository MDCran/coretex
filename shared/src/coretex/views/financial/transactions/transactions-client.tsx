// @ts-nocheck





import { AmountBadge } from "../_components/amount-badge";
import { CategoryBadge } from "../_components/category-badge";
import { categoryColor, categoryIcon } from "../_components/category-icons";
import { TransactionLedgerTable } from "../_components/transaction-ledger-table";
import { BloomCard, Card, EmptyRow, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader, TableCard, TableHeaderHelp } from "../_components/financial-ui";
import { ControlledDateInput, FormDateInput } from "@/components/base/input/form-date-input";
import { FormModal } from "../_components/form-modal";
import { SplitModal } from "../_components/split-modal";
import { FileUploadDropZone } from "@/components/application/file-upload/file-upload-base";
import { MerchantLogo } from "../_components/merchant-logo";
import { OwnerSelect } from "./owner-select";
import { cx } from "@/utils/cx";
import { Badge } from "@/components/base/badges/badges";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { FileCheck02, CreditCard02, Bank, MagicWand02, Eye, LayersTwo01, Edit01, Trash02, UploadCloud02, Plus, Download01, X, SearchRefraction, Receipt, Paperclip, ChevronDown, ChevronRight } from "@untitledui/icons";
import { useState, useMemo, useRef } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "../../personal/personal-ui";
import { useLifeOSMutation } from "../../personal/use-lifeos-mutation";
import type { LifeOSClient } from "../../personal/use-lifeos-query";

export interface StatementInfo {
    id: string;
    fileName: string;
}

export interface TxnRow {
    id: string;
    finAccountId: string | null;
    creditCardId: string | null;
    date: string; // YYYY-MM-DD
    amount: number;
    currency: string;
    merchant: string | null;
    rawDescription: string | null;
    categoryId: string | null;
    pending: boolean;
    source: string;
    plaidTransactionId: string | null;
    plaidCategory: string | null;
    plaidAccount: {
        id: string;
        plaidAccountId: string;
        name: string;
        officialName: string | null;
        mask: string | null;
        type: string;
        subtype: string | null;
        institutionName: string | null;
        lastSyncedAt: string | null;
        lastBalanceSyncAt: string | null;
    } | null;
    notes: string | null;
    hasReceipt?: boolean;
    receiptFileName?: string | null;
    createdAt: string;
    updatedAt: string;
    statement: StatementInfo | null;
    splits: { categoryId: string | null; amount: number }[];
}

export interface OwnerOpt {
    id: string;
    kind: "account" | "card";
    nickname: string;
    institution: string | null;
    monogram: string;
    masked: string | null;
    typeLabel: string;
}

interface TransactionPagination {
    offset: number;
    limit: number;
    total: number;
    hasPrevious: boolean;
    hasMore: boolean;
}

interface Opt {
    id: string;
    label: string;
    color?: string | null;
}

const SOURCES = ["MANUAL", "CSV", "STATEMENT", "PLAID"];
type SortMode = "date-desc" | "date-asc" | "amount-desc" | "amount-asc" | "merchant-asc" | "merchant-desc" | "account-asc" | "category-asc" | "source-asc";
type GroupMode = "none" | "merchant" | "account" | "category" | "source";
type QuickFilter = "" | "accounts" | "cards";
type SummaryRange = "30d" | "6m" | "1y" | "all";

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
    { id: "date-desc", label: "Newest first" },
    { id: "date-asc", label: "Oldest first" },
    { id: "amount-desc", label: "Amount high to low" },
    { id: "amount-asc", label: "Amount low to high" },
    { id: "merchant-asc", label: "Merchant A-Z" },
    { id: "merchant-desc", label: "Merchant Z-A" },
    { id: "account-asc", label: "Account/Card A-Z" },
    { id: "category-asc", label: "Category A-Z" },
    { id: "source-asc", label: "Source A-Z" },
];

const GROUP_OPTIONS: { id: GroupMode; label: string }[] = [
    { id: "none", label: "No grouping" },
    { id: "merchant", label: "Merchant" },
    { id: "account", label: "Account/Card" },
    { id: "category", label: "Category" },
    { id: "source", label: "Source" },
];

const SUMMARY_RANGES: { id: SummaryRange; label: string }[] = [
    { id: "30d", label: "Last 30 days" },
    { id: "6m", label: "6 months" },
    { id: "1y", label: "1 year" },
    { id: "all", label: "All time" },
];

function localDateKey(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function summaryRangeStart(range: SummaryRange): string | null {
    if (range === "all") return null;
    const d = new Date();
    if (range === "30d") d.setDate(d.getDate() - 29);
    if (range === "6m") d.setMonth(d.getMonth() - 6);
    if (range === "1y") d.setFullYear(d.getFullYear() - 1);
    return localDateKey(d);
}

/** Minimal CSV parser supporting quoted fields. Returns array of string arrays. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else inQuotes = false;
            } else cur += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ",") {
            row.push(cur);
            cur = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(cur);
            cur = "";
            if (row.some((c) => c.trim() !== "")) rows.push(row);
            row = [];
        } else cur += ch;
    }
    if (cur !== "" || row.length) {
        row.push(cur);
        if (row.some((c) => c.trim() !== "")) rows.push(row);
    }
    return rows;
}

function normDate(s: string): string | null {
    const t = s.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
}

function csvCell(value: unknown): string {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function fileToBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 32_768;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunkSize)));
    }
    return window.btoa(binary);
}

/** Attach/view/remove a receipt image or PDF on a transaction, shown in the detail modal. */
function ReceiptAction({
    row,
    busy,
    onAttach,
    onView,
    onRemove,
}: {
    row: TxnRow;
    busy: boolean;
    onAttach: (file: File) => void;
    onView: () => void;
    onRemove: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    if (row.hasReceipt) {
        return (
            <span className="inline-flex items-center gap-2">
                <button type="button" className="max-w-40 truncate text-brand-secondary hover:underline" onClick={onView}>
                    View receipt
                </button>
                <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={onRemove} isDisabled={busy} aria-label="Remove receipt" />
            </span>
        );
    }
    return (
        <>
            <Button size="sm" color="secondary" iconLeading={Paperclip} onClick={() => inputRef.current?.click()} isLoading={busy} showTextWhileLoading>
                Attach receipt
            </Button>
            <input
                ref={inputRef}
                type="file"
                accept="image/*,.pdf"
                className="sr-only"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onAttach(file);
                }}
            />
        </>
    );
}

function formatDateTime(value: string | null): string {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function TransactionsClient({
    client,
    transactions,
    accounts,
    cards,
    categories,
    pagination,
    onPageChange,
}: {
    client: LifeOSClient;
    transactions: TxnRow[];
    accounts: OwnerOpt[];
    cards: OwnerOpt[];
    categories: Opt[];
    pagination?: TransactionPagination;
    onPageChange?: (offset: number) => void;
}) {
    const createMutation = useLifeOSMutation(client, "financial:createTransaction");
    const updateMutation = useLifeOSMutation(client, "financial:updateTransaction");
    const deleteMutation = useLifeOSMutation(client, "financial:deleteTransaction");
    const assignMutation = useLifeOSMutation(client, "financial:setTransactionCategory");
    const aiCategorizeMutation = useLifeOSMutation(client, "financial:aiCategorizeTransaction");
    const importMutation = useLifeOSMutation(client, "financial:importTransactions");
    const attachReceiptMutation = useLifeOSMutation(client, "financial:attachReceipt");
    const deleteReceiptMutation = useLifeOSMutation(client, "financial:deleteReceipt");
    const getFileMutation = useLifeOSMutation(client, "financial:getFinancialFile");
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<TxnRow | null>(null);
    const [splitRow, setSplitRow] = useState<TxnRow | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [importTarget, setImportTarget] = useState<string>("");
    const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
    const [importing, setImporting] = useState(false);
    const [aiRowId, setAiRowId] = useState<string | null>(null);
    const [deleteRow, setDeleteRow] = useState<TxnRow | null>(null);
    const [detailRow, setDetailRow] = useState<TxnRow | null>(null);
    const [stmtPreview, setStmtPreview] = useState<StatementInfo | null>(null);
    const [stmtFileUrl, setStmtFileUrl] = useState<string | null>(null);
    const [receiptPreview, setReceiptPreview] = useState<TxnRow | null>(null);
    const [receiptFileUrl, setReceiptFileUrl] = useState<string | null>(null);
    async function openStatementPreview(statement: StatementInfo | null) {
        if (!statement) return;
        setStmtPreview(statement);
        setStmtFileUrl(null);
        try {
            const file = await getFileMutation.mutate<{ fileName: string; mimeType: string; base64: string }>({ id: statement.id });
            setStmtFileUrl(`data:${file.mimeType || "application/octet-stream"};base64,${file.base64}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't open that statement.");
        }
    }
    // owner select state for the create/edit form
    const [formAccountId, setFormAccountId] = useState("");
    const [formCardId, setFormCardId] = useState("");

    const owners = useMemo(() => [...accounts, ...cards], [accounts, cards]);
    const ownerById = useMemo(() => new Map(owners.map((o) => [o.id, o])), [owners]);
    const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

    async function onCategorizeWithAi(id: string) {
        setAiRowId(id);
        try {
            const res = await aiCategorizeMutation.mutate<{ categoryId?: string }>({ id });
            toast.success(res.categoryId ? "Category updated with AI" : "No confident category match found");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "AI categorization failed");
        } finally {
            setAiRowId(null);
        }
    }

    // filters
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [acctFilter, setAcctFilter] = useState("");
    const [quickFilter, setQuickFilter] = useState<QuickFilter>("");
    const [catFilter, setCatFilter] = useState("");
    const [srcFilter, setSrcFilter] = useState("");
    const [search, setSearch] = useState("");
    const [sortMode, setSortMode] = useState<SortMode>("date-desc");
    const [groupMode, setGroupMode] = useState<GroupMode>("none");
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [summaryRange, setSummaryRange] = useState<SummaryRange>("all");

    const catName = (id: string | null) => (id ? (categoryById.get(id)?.label ?? "—") : "—");
    const ownerLabel = (id: string | null) => (id ? (ownerById.get(id)?.nickname ?? "—") : "—");

    function compareText(a: string, b: string) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    }

    function sortRows(a: TxnRow, b: TxnRow): number {
        const merchantA = a.merchant || a.rawDescription || "";
        const merchantB = b.merchant || b.rawDescription || "";
        const accountA = ownerLabel(a.finAccountId ?? a.creditCardId);
        const accountB = ownerLabel(b.finAccountId ?? b.creditCardId);
        const categoryA = catName(a.categoryId);
        const categoryB = catName(b.categoryId);
        const dateDesc = b.date.localeCompare(a.date) || compareText(merchantA, merchantB);

        switch (sortMode) {
            case "date-asc":
                return a.date.localeCompare(b.date) || compareText(merchantA, merchantB);
            case "amount-desc":
                return b.amount - a.amount || dateDesc;
            case "amount-asc":
                return a.amount - b.amount || dateDesc;
            case "merchant-asc":
                return compareText(merchantA, merchantB) || dateDesc;
            case "merchant-desc":
                return compareText(merchantB, merchantA) || dateDesc;
            case "account-asc":
                return compareText(accountA, accountB) || dateDesc;
            case "category-asc":
                return compareText(categoryA, categoryB) || dateDesc;
            case "source-asc":
                return compareText(a.source, b.source) || dateDesc;
            case "date-desc":
            default:
                return dateDesc;
        }
    }

    function matchesSharedFilters(t: TxnRow): boolean {
        if (quickFilter === "accounts" && !t.finAccountId) return false;
        if (quickFilter === "cards" && !t.creditCardId) return false;
        if (acctFilter && t.finAccountId !== acctFilter && t.creditCardId !== acctFilter) return false;
        if (catFilter && (catFilter === "__none" ? t.categoryId !== null : t.categoryId !== catFilter)) return false;
        if (srcFilter && t.source !== srcFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            const owner = ownerById.get(t.finAccountId ?? t.creditCardId ?? "");
            const category = t.categoryId ? categoryById.get(t.categoryId)?.label : null;
            const haystack = [
                t.id,
                t.merchant,
                t.rawDescription,
                owner?.nickname,
                owner?.institution,
                owner?.masked,
                owner?.typeLabel,
                category,
                t.source,
                t.pending ? "pending" : "posted",
                t.currency,
                t.plaidTransactionId,
                t.plaidCategory,
                t.plaidAccount?.institutionName,
                t.plaidAccount?.name,
                t.plaidAccount?.officialName,
                t.plaidAccount?.mask,
                t.plaidAccount?.plaidAccountId,
                t.statement?.fileName,
                t.statement?.period,
                t.notes,
                t.date,
                t.amount.toFixed(2),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        return true;
    }

    const filtered = useMemo(() => {
        const out = transactions.filter((t) => {
            if (from && t.date < from) return false;
            if (to && t.date > to) return false;
            return matchesSharedFilters(t);
        });
        out.sort(sortRows);
        return out;
    }, [transactions, from, to, acctFilter, quickFilter, catFilter, srcFilter, search, sortMode, ownerById, categoryById]);

    const summaryStart = useMemo(() => summaryRangeStart(summaryRange), [summaryRange]);
    const summaryTransactions = useMemo(
        () =>
            transactions.filter((t) => {
                if (!matchesSharedFilters(t)) return false;
                return !summaryStart || t.date >= summaryStart;
            }),
        [transactions, summaryStart, acctFilter, quickFilter, catFilter, srcFilter, search, ownerById, categoryById],
    );

    const totals = useMemo(() => {
        let inflow = 0;
        let outflow = 0;
        for (const t of summaryTransactions) {
            if (t.amount >= 0) inflow += t.amount;
            else outflow += t.amount;
        }
        return { inflow, outflow, net: inflow + outflow };
    }, [summaryTransactions]);

    // Spending by category (filtered outflows), top 6.
    const spendingByCat = useMemo(() => {
        const map = new Map<string, { key: string; name: string; value: number; color: string | null }>();
        for (const t of filtered) {
            if (t.amount >= 0) continue;
            const category = t.categoryId ? categoryById.get(t.categoryId) : null;
            const key = t.categoryId ?? "__uncategorized";
            const name = category?.label ?? "Uncategorized";
            const current = map.get(key) ?? {
                key,
                name,
                value: 0,
                color: categoryColor(name, category?.color),
            };
            current.value += Math.abs(t.amount);
            map.set(key, current);
        }
        return [...map.values()].sort((a, b) => b.value - a.value);
    }, [filtered, categoryById]);
    const maxSpend = spendingByCat[0]?.value ?? 0;

    function groupMeta(t: TxnRow): { key: string; label: string; color: string | null } {
        if (groupMode === "merchant") {
            const label = (t.merchant || t.rawDescription || "Unknown merchant").trim() || "Unknown merchant";
            return { key: `merchant:${label}`, label, color: null };
        }
        if (groupMode === "account") {
            const ownerId = t.finAccountId ?? t.creditCardId ?? "";
            return { key: `account:${ownerId || "__none"}`, label: ownerId ? ownerLabel(ownerId) : "No account/card", color: null };
        }
        if (groupMode === "category") {
            const category = t.categoryId ? categoryById.get(t.categoryId) : null;
            const label = category?.label ?? "Uncategorized";
            return { key: `category:${t.categoryId ?? "__none"}`, label, color: categoryColor(label, category?.color) };
        }
        const label = t.source || "Unknown source";
        return { key: `source:${label}`, label, color: null };
    }

    const transactionGroups = useMemo(() => {
        if (groupMode === "none") return [];
        const map = new Map<string, { key: string; label: string; color: string | null; rows: TxnRow[]; total: number }>();
        for (const t of filtered) {
            const meta = groupMeta(t);
            const g = map.get(meta.key) ?? { ...meta, rows: [], total: 0 };
            g.rows.push(t);
            g.total += t.amount;
            map.set(meta.key, g);
        }
        return [...map.values()].sort((a, b) => compareText(a.label, b.label));
    }, [filtered, groupMode, ownerById, categoryById]);

    function toggleGroup(key: string) {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    function openCreate() {
        setEditing(null);
        setFormAccountId("");
        setFormCardId("");
        setOpen(true);
    }
    function openEdit(row: TxnRow) {
        setEditing(row);
        setFormAccountId(row.finAccountId ?? "");
        setFormCardId(row.creditCardId ?? "");
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        // owner ids come from controlled OwnerSelect state, not native inputs
        const payload = {
            date: String(fd.get("date") ?? ""),
            amount: String(fd.get("amount") ?? ""),
            merchant: String(fd.get("merchant") ?? ""),
            rawDescription: String(fd.get("rawDescription") ?? ""),
            finAccountId: formAccountId,
            creditCardId: formCardId,
            categoryId: String(fd.get("categoryId") ?? ""),
            notes: String(fd.get("notes") ?? ""),
        };
        try {
            if (editing) await updateMutation.mutate({ id: editing.id, ...payload });
            else await createMutation.mutate(payload);
            toast.success(editing ? "Transaction updated" : "Transaction added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onDeleteConfirmed() {
        if (!deleteRow) return;
        try {
            await deleteMutation.mutate({ id: deleteRow.id });
            toast.success("Deleted");
            setDeleteRow(null);
        } catch {
            toast.error("Failed");
        }
    }
    async function onAssign(id: string, categoryId: string | null) {
        try {
            await assignMutation.mutate({ id, categoryId: categoryId || null });
        } catch {
            toast.error("Failed to set category");
        }
    }

    const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);
    async function onAttachReceipt(row: TxnRow, file: File) {
        setReceiptBusyId(row.id);
        try {
            const base64 = await fileToBase64(file);
            await attachReceiptMutation.mutate({ id: row.id, fileName: file.name, mimeType: file.type || "application/octet-stream", base64 });
            toast.success("Receipt attached");
            setDetailRow((prev) => (prev && prev.id === row.id ? { ...prev, hasReceipt: true, receiptFileName: file.name } : prev));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't attach that receipt.");
        } finally {
            setReceiptBusyId(null);
        }
    }
    async function onViewReceipt(row: TxnRow) {
        setReceiptPreview(row);
        setReceiptFileUrl(null);
        try {
            const file = await getFileMutation.mutate<{ fileName: string; mimeType: string; base64: string }>({ id: row.id });
            setReceiptFileUrl(`data:${file.mimeType || "application/octet-stream"};base64,${file.base64}`);
        } catch (e) {
            setReceiptPreview(null);
            toast.error(e instanceof Error ? e.message : "Couldn't open that receipt.");
        }
    }
    async function onRemoveReceipt(row: TxnRow) {
        setReceiptBusyId(row.id);
        try {
            await deleteReceiptMutation.mutate({ id: row.id });
            toast.success("Receipt removed");
            setDetailRow((prev) => (prev && prev.id === row.id ? { ...prev, hasReceipt: false, receiptFileName: null } : prev));
        } catch {
            toast.error("Couldn't remove the receipt.");
        } finally {
            setReceiptBusyId(null);
        }
    }

    function onFilePicked(file: File) {
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result ?? "");
            const grid = parseCsv(text);
            if (grid.length < 2) {
                toast.error("CSV looks empty");
                return;
            }
            const header = grid[0].map((h) => h.trim().toLowerCase());
            const dateIdx = header.findIndex((h) => h.includes("date"));
            const amtIdx = header.findIndex((h) => h === "amount" || h.includes("amount"));
            const descIdx = header.findIndex((h) => h.includes("description") || h.includes("merchant") || h.includes("name") || h.includes("payee"));
            if (dateIdx < 0 || amtIdx < 0) {
                toast.error("CSV must have date and amount columns");
                return;
            }
            const parsed: ImportRow[] = [];
            for (let i = 1; i < grid.length; i++) {
                const cells = grid[i];
                const date = normDate(cells[dateIdx] ?? "");
                const amount = Number((cells[amtIdx] ?? "").replace(/[$,]/g, "").trim());
                if (!date || !Number.isFinite(amount)) continue;
                const desc = descIdx >= 0 ? (cells[descIdx] ?? "").trim() : "";
                parsed.push({ date, amount, merchant: desc || null, rawDescription: desc || null });
            }
            if (!parsed.length) {
                toast.error("No valid rows found");
                return;
            }
            setImportRows(parsed);
            toast.success(`${parsed.length} rows parsed`);
        };
        reader.readAsText(file);
    }

    async function runImport() {
        if (!importRows) return;
        setImporting(true);
        try {
            const target = importTarget;
            const isCard = cards.some((c) => c.id === target);
            const res = await importMutation.mutate<{ inserted: number; skipped: number }>({
                finAccountId: target && !isCard ? target : null,
                creditCardId: target && isCard ? target : null,
                rows: importRows,
            });
            toast.success(`Imported ${res.inserted}, skipped ${res.skipped} duplicates`);
            setImportOpen(false);
            setImportRows(null);
            setImportTarget("");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Import failed");
        } finally {
            setImporting(false);
        }
    }

    const targetOptions = [...accounts.map((a) => ({ ...a, group: "Accounts" })), ...cards.map((c) => ({ ...c, group: "Cards" }))];
    const hasFilters = Boolean(from || to || acctFilter || quickFilter || catFilter || srcFilter || search);

    /** Signed amount with owner-aware wording for the detail modal. */
    function amountWording(row: TxnRow): string {
        const isCard = Boolean(row.creditCardId);
        if (row.amount >= 0) return isCard ? "Credit / payment" : "Deposit";
        return isCard ? "Charge" : "Withdrawal";
    }

    function exportTransactions(rows: TxnRow[], scope: "filtered" | "page") {
        if (rows.length === 0) {
            toast.info("No transactions to export");
            return;
        }
        const header = [
            "Date",
            "Amount",
            "Currency",
            "Merchant",
            "Raw description",
            "Account/Card",
            "Category",
            "Source",
            "Status",
            "Plaid transaction ID",
            "Plaid category",
            "Plaid institution",
            "Plaid account",
            "Statement",
            "Statement period",
            "Notes",
            "LifeOS transaction ID",
        ];
        const csv = [
            header,
            ...rows.map((t) => {
                const owner = ownerById.get(t.finAccountId ?? t.creditCardId ?? "");
                return [
                    t.date,
                    t.amount.toFixed(2),
                    t.currency,
                    t.merchant ?? "",
                    t.rawDescription ?? "",
                    owner ? `${owner.nickname}${owner.masked ? ` (${owner.masked})` : ""}` : "",
                    catName(t.categoryId),
                    t.source,
                    t.pending ? "Pending" : "Posted",
                    t.plaidTransactionId ?? "",
                    t.plaidCategory ?? "",
                    t.plaidAccount?.institutionName ?? "",
                    t.plaidAccount?.officialName ?? t.plaidAccount?.name ?? "",
                    t.statement?.fileName ?? "",
                    t.statement?.period ?? "",
                    t.notes ?? "",
                    t.id,
                ];
            }),
        ]
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n");
        downloadText(`lifeos-transactions-${scope}-${localDateKey(new Date())}.csv`, csv);
        toast.success(`Exported ${rows.length} transactions`);
    }

    const ledgerOwners = useMemo(
        () => owners.map((o) => ({ id: o.id, kind: o.kind, nickname: o.nickname })),
        [owners],
    );

    const ledgerProps = {
        categories,
        owners: ledgerOwners,
        onRowOpen: (row) => setDetailRow(row as TxnRow),
        onAssignCategory: (id: string, categoryId: string | null) => void onAssign(id, categoryId),
        onViewStatement: (statement: StatementInfo) => void openStatementPreview(statement),
        onEdit: (row) => openEdit(row as TxnRow),
        onDelete: (row) => setDeleteRow(row as TxnRow),
        onSplit: (row) => setSplitRow(row as TxnRow),
        onAiCategorize: (row) => void onCategorizeWithAi(row.id),
        aiBusyId: aiRowId,
    };

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Transactions"
                description={pagination && pagination.total > pagination.limit
                    ? `Manual entries, imports and statement activity. Showing ${pagination.offset + 1}–${Math.min(pagination.offset + transactions.length, pagination.total)} of ${pagination.total.toLocaleString()}.`
                    : "Manual entries, CSV imports and statement-extracted activity."}
                action={
                    <div className="flex flex-wrap gap-2">
                        <Button size="md" color="secondary" iconLeading={UploadCloud02} onClick={() => setImportOpen(true)}>
                            Import CSV
                        </Button>
                        <Button size="md" iconLeading={Plus} onClick={openCreate}>
                            Add transaction
                        </Button>
                    </div>
                }
            />

            <div className="flex flex-col gap-3">
                <div className="flex justify-end">
                    <div role="radiogroup" aria-label="Summary period" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-secondary p-1 ring-1 ring-secondary ring-inset">
                        {SUMMARY_RANGES.map((range) => (
                            <button
                                key={range.id}
                                type="button"
                                aria-pressed={summaryRange === range.id}
                                onClick={() => setSummaryRange(range.id)}
                                className={cx(
                                    "h-8 shrink-0 rounded-md px-3 text-xs font-semibold transition duration-100 ease-linear",
                                    summaryRange === range.id ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary",
                                )}
                            >
                                {range.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <BloomCard bloom="success">
                        <p className="text-sm text-tertiary">Inflow</p>
                        <p className="text-display-xs font-semibold text-success-primary">{formatCurrency(totals.inflow)}</p>
                        <p className="text-xs text-tertiary">USD</p>
                    </BloomCard>
                    <BloomCard bloom="error">
                        <p className="text-sm text-tertiary">Outflow</p>
                        <p className="text-display-xs font-semibold text-error-primary">{formatCurrency(totals.outflow)}</p>
                        <p className="text-xs text-tertiary">USD</p>
                    </BloomCard>
                    <BloomCard bloom="brand">
                        <p className="text-sm text-tertiary">Net</p>
                        <p className="text-display-xs font-semibold text-primary">{formatCurrency(totals.net)}</p>
                        <p className="text-xs text-tertiary">USD</p>
                    </BloomCard>
                </div>
            </div>

            <Card className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <ControlledDateInput label="From" value={from || null} onChange={setFrom} />
                    <ControlledDateInput label="To" value={to || null} onChange={setTo} />
                    <Field label="Account/Card">
                        <OwnerSelect options={owners} value={acctFilter} onChange={setAcctFilter} allowAll allLabel="All" aria-label="Filter by account or card" placeholder="All" />
                    </Field>
                    <Field label="Category">
                        <NativeSelect value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                            <option value="">All</option>
                            <option value="__none">Uncategorized</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <Field label="Source">
                        <NativeSelect value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)}>
                            <option value="">All</option>
                            {SOURCES.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <Field label="Search">
                        <NativeInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Merchant, account, category, amount..." />
                    </Field>
                </div>

                {/* Quick filters + view controls */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-tertiary">Quick:</span>
                    {(
                        [
                            { id: "", label: "All" },
                            { id: "accounts", label: "Accounts only" },
                            { id: "cards", label: "Cards only" },
                        ] as { id: QuickFilter; label: string }[]
                    ).map((q) => (
                        <button
                            key={q.id || "all"}
                            type="button"
                            onClick={() => setQuickFilter(q.id)}
                            aria-pressed={quickFilter === q.id}
                            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition duration-100 ease-linear ${
                                quickFilter === q.id ? "bg-brand-primary text-brand-secondary ring-brand" : "bg-primary text-tertiary ring-secondary hover:text-secondary"
                            }`}
                        >
                            {q.label}
                        </button>
                    ))}
                    <span className="mx-1 h-4 w-px bg-border-secondary" aria-hidden="true" />
                    <label className="flex items-center gap-1.5 text-xs font-medium text-tertiary">
                        Sort
                        <NativeSelect value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="h-8 w-44 py-1 text-xs">
                            {SORT_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-tertiary">
                        Group
                        <NativeSelect
                            value={groupMode}
                            onChange={(e) => {
                                setGroupMode(e.target.value as GroupMode);
                                setCollapsedGroups(new Set());
                            }}
                            className="h-8 w-40 py-1 text-xs"
                        >
                            {GROUP_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </label>
                    <Button size="sm" color="secondary" iconLeading={Download01} onClick={() => exportTransactions(filtered, "filtered")}>
                        Export CSV
                    </Button>
                    <Button size="sm" color="link-gray" onClick={() => exportTransactions(transactions, "page")}>
                        Export loaded page
                    </Button>
                    {hasFilters && (
                        <Button
                            size="sm"
                            color="link-gray"
                            iconLeading={X}
                            onClick={() => {
                                setFrom("");
                                setTo("");
                                setAcctFilter("");
                                setQuickFilter("");
                                setCatFilter("");
                                setSrcFilter("");
                                setSearch("");
                            }}
                        >
                            Clear filters
                        </Button>
                    )}
                </div>
            </Card>

            {spendingByCat.length > 0 && (
                <BloomCard bloom="brand" className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-primary">Spending by category{hasFilters ? " (filtered)" : ""}</h3>
                    <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {spendingByCat.slice(0, 6).map((s) => (
                            <li
                                key={s.key}
                                className="flex min-w-0 items-center gap-3 rounded-lg bg-secondary_subtle px-3 py-2 ring-1 ring-secondary ring-inset"
                                style={s.color ? { backgroundColor: `${s.color}12`, boxShadow: `inset 0 0 0 1px ${s.color}2E` } : undefined}
                            >
                                <span className="flex min-w-0 flex-1 items-center gap-2">
                                    {(() => {
                                        const Icon = categoryIcon(s.name);
                                        return (
                                            <span
                                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md"
                                                style={{ backgroundColor: `${s.color ?? "#6B7280"}22`, color: s.color ?? "#6B7280" }}
                                            >
                                                <Icon className="size-3.5" aria-hidden="true" />
                                            </span>
                                        );
                                    })()}
                                    <span className="truncate text-xs font-medium text-secondary">{s.name}</span>
                                </span>
                                <div className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-quaternary">
                                    <div
                                        className="h-full rounded-full transition-all duration-300"
                                        style={{ width: `${maxSpend > 0 ? (s.value / maxSpend) * 100 : 0}%`, backgroundColor: s.color ?? "var(--color-brand-solid)" }}
                                    />
                                </div>
                                <span className="w-20 shrink-0 text-right text-xs font-medium text-primary">{formatCurrency(s.value)}</span>
                            </li>
                        ))}
                    </ul>
                </BloomCard>
            )}

            {groupMode !== "none" && (
                <div className="flex flex-col gap-2">
                    {transactionGroups.map((g) => {
                        const isOpen = !collapsedGroups.has(g.key);
                        return (
                            <div key={g.key} className="overflow-hidden rounded-xl ring-1 ring-secondary ring-inset">
                                <button
                                    type="button"
                                    className="flex w-full items-center justify-between gap-3 bg-secondary_subtle px-4 py-2.5 text-left"
                                    onClick={() => toggleGroup(g.key)}
                                >
                                    <span className="flex min-w-0 items-center gap-2 font-medium text-primary">
                                        {isOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                                        {groupMode === "merchant" ? (
                                            <MerchantLogo merchant={g.label} size="xs" />
                                        ) : g.color ? (
                                            <span className="size-3 rounded-sm" style={{ backgroundColor: g.color }} aria-hidden="true" />
                                        ) : (
                                            <LayersTwo01 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                        )}
                                        <span className="truncate">{g.label}</span>
                                        <Badge size="sm" color="gray">
                                            {g.rows.length}
                                        </Badge>
                                    </span>
                                    <AmountBadge amount={g.total} />
                                </button>
                                {isOpen && (
                                    <TransactionLedgerTable
                                        transactions={g.rows}
                                        {...ledgerProps}
                                        empty={<EmptyRow colSpan={6} label="No transactions in this group." />}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {groupMode === "none" && (
                <>
                    <TransactionLedgerTable
                        transactions={filtered}
                        {...ledgerProps}
                        empty={
                            hasFilters ? (
                                <EmptyRow
                                    colSpan={6}
                                    icon={SearchRefraction}
                                    title="No transactions match these filters"
                                    description="Try widening the date range or clearing filters to see more activity."
                                    action={
                                        <Button
                                            size="sm"
                                            color="secondary"
                                            iconLeading={X}
                                            onClick={() => {
                                                setFrom("");
                                                setTo("");
                                                setAcctFilter("");
                                                setQuickFilter("");
                                                setCatFilter("");
                                                setSrcFilter("");
                                                setSearch("");
                                            }}
                                        >
                                            Clear filters
                                        </Button>
                                    }
                                />
                            ) : (
                                <EmptyRow
                                    colSpan={6}
                                    icon={Receipt}
                                    title="Start tracking your money"
                                    description="Add a transaction by hand or import a CSV — your inflow, outflow and spending insights update instantly."
                                    action={
                                        <>
                                            <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                                Add transaction
                                            </Button>
                                            <Button size="sm" color="secondary" iconLeading={UploadCloud02} onClick={() => setImportOpen(true)}>
                                                Import CSV
                                            </Button>
                                        </>
                                    }
                                />
                            )
                        }
                    />
                </>
            )}

            {pagination && pagination.total > pagination.limit && (
                <nav aria-label="Transaction pages" className="flex flex-col gap-2 rounded-xl border border-secondary bg-primary px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-tertiary">
                        Showing {pagination.total === 0 ? 0 : pagination.offset + 1}–{Math.min(pagination.offset + transactions.length, pagination.total)} of {pagination.total.toLocaleString()} newest transactions. Filters and exports apply to this loaded page.
                    </p>
                    <div className="flex shrink-0 gap-2">
                        <Button size="sm" color="secondary" isDisabled={!pagination.hasPrevious} onClick={() => onPageChange?.(Math.max(0, pagination.offset - pagination.limit))}>
                            Newer
                        </Button>
                        <Button size="sm" color="secondary" isDisabled={!pagination.hasMore} onClick={() => onPageChange?.(pagination.offset + pagination.limit)}>
                            Older
                        </Button>
                    </div>
                </nav>
            )}

            {/* Add/Edit modal */}
            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit transaction" : "Add transaction"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <div className="grid grid-cols-2 gap-4">
                        <FormDateInput name="date" label="Date" isRequired defaultValue={editing?.date ?? new Date().toISOString().slice(0, 10)} />
                        <Field label="Amount" htmlFor="amount" hint="Negative = spending">
                            <NativeInput id="amount" name="amount" type="number" step="0.01" required defaultValue={editing?.amount ?? ""} />
                        </Field>
                    </div>
                    <Field label="Merchant" htmlFor="merchant">
                        <NativeInput id="merchant" name="merchant" defaultValue={editing?.merchant ?? ""} placeholder="e.g. Whole Foods" />
                    </Field>
                    <Field label="Raw description" htmlFor="rawDescription" hint="Original bank/card descriptor (kept for reference)">
                        <NativeInput id="rawDescription" name="rawDescription" defaultValue={editing?.rawDescription ?? ""} />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Account">
                            <OwnerSelect
                                options={accounts}
                                value={formAccountId}
                                onChange={(v) => {
                                    setFormAccountId(v);
                                    if (v) setFormCardId("");
                                }}
                                placeholder="— none —"
                                aria-label="Account"
                            />
                        </Field>
                        <Field label="Card">
                            <OwnerSelect
                                options={cards}
                                value={formCardId}
                                onChange={(v) => {
                                    setFormCardId(v);
                                    if (v) setFormAccountId("");
                                }}
                                placeholder="— none —"
                                aria-label="Card"
                            />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Category" htmlFor="categoryId">
                            <NativeSelect id="categoryId" name="categoryId" defaultValue={editing?.categoryId ?? ""}>
                                <option value="">Uncategorized</option>
                                {categories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Source" htmlFor="source">
                            <NativeSelect id="source" name="source" defaultValue={editing?.source ?? "MANUAL"}>
                                {SOURCES.map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
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

            {/* Import modal */}
            <FormModal isOpen={importOpen} onOpenChange={setImportOpen} title="Import transactions from CSV" description="CSV needs date and amount columns (description optional).">
                <div className="flex flex-col gap-4">
                    <Field label="Assign to account/card (optional)">
                        <NativeSelect value={importTarget} onChange={(e) => setImportTarget(e.target.value)}>
                            <option value="">— none —</option>
                            {targetOptions.map((o) => (
                                <option key={o.id} value={o.id}>
                                    {o.group}: {o.nickname}
                                    {o.masked ? ` (${o.masked})` : ""}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <FileUploadDropZone
                        accept=".csv,text/csv"
                        allowsMultiple={false}
                        hint="CSV file with date and amount columns."
                        onDropFiles={(files) => {
                            const f = files[0];
                            if (f) onFilePicked(f);
                        }}
                    />
                    {importRows && <p className="text-sm text-tertiary">{importRows.length} rows ready to import. Duplicates are skipped automatically.</p>}
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setImportOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={runImport} isDisabled={!importRows} isLoading={importing}>
                            Import {importRows ? `(${importRows.length})` : ""}
                        </Button>
                    </div>
                </div>
            </FormModal>

            {splitRow && (
                <SplitModal
                    client={client}
                    isOpen={!!splitRow}
                    onOpenChange={(o) => !o && setSplitRow(null)}
                    transactionId={splitRow.id}
                    total={splitRow.amount}
                    categories={categories}
                    existingSplits={splitRow.splits}
                />
            )}

            {/* Delete confirm modal */}
            <FormModal isOpen={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)} title="Delete transaction?" description="This permanently removes the transaction.">
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-tertiary">
                        Delete <span className="font-medium text-primary">{deleteRow?.merchant || deleteRow?.rawDescription || "this transaction"}</span> ({deleteRow ? formatCurrency(deleteRow.amount) : ""})? This cannot be undone.
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" type="button" onClick={() => setDeleteRow(null)}>
                            Cancel
                        </Button>
                        <Button color="primary-destructive" type="button" onClick={onDeleteConfirmed}>
                            Delete
                        </Button>
                    </div>
                </div>
            </FormModal>

            {/* Detail slideout — fixed right panel above Agents/Terminals/Alerts dock */}
            <SlideoutMenu isOpen={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)} isDismissable dialogClassName="gap-0">
                <SlideoutMenu.Header onClose={() => setDetailRow(null)} className="flex w-full flex-col gap-1 pb-4">
                    <h2 className="pr-10 text-lg font-semibold text-primary">Transaction details</h2>
                    {detailRow && (
                        <p className="truncate text-sm text-tertiary">
                            {detailRow.merchant || detailRow.rawDescription || "Transaction"} · {formatDate(detailRow.date)}
                        </p>
                    )}
                </SlideoutMenu.Header>
                <SlideoutMenu.Content className="py-4">
                    {detailRow && (
                        <dl className="flex w-full flex-col divide-y divide-secondary text-sm">
                            <DetailItem label="Date" value={formatDate(detailRow.date)} />
                            <DetailItem
                                label="Merchant"
                                value={
                                    <span className="inline-flex max-w-full items-center justify-end gap-2">
                                        <MerchantLogo merchant={detailRow.merchant || detailRow.rawDescription || "Unknown merchant"} size="xs" />
                                        <span className="truncate">{detailRow.merchant || "—"}</span>
                                    </span>
                                }
                            />
                            <DetailItem label="Raw description" value={detailRow.rawDescription || "—"} />
                            <DetailItem
                                label="Amount"
                                value={
                                    <span className={detailRow.amount < 0 ? "text-primary" : "text-success-primary"}>
                                        {formatCurrency(detailRow.amount)}{" "}
                                        <span className="text-tertiary">({amountWording(detailRow)})</span>
                                    </span>
                                }
                            />
                            <DetailItem
                                label="Category"
                                value={
                                    <CategoryBadge
                                        name={detailRow.categoryId ? catName(detailRow.categoryId) : "Uncategorized"}
                                        color={
                                            detailRow.categoryId
                                                ? categoryColor(
                                                      catName(detailRow.categoryId),
                                                      categoryById.get(detailRow.categoryId)?.color,
                                                  )
                                                : categoryColor("Uncategorized")
                                        }
                                    />
                                }
                            />
                            <DetailItem label="Source" value={detailRow.source} />
                            <DetailItem label="Account / Card" value={ownerLabel(detailRow.finAccountId ?? detailRow.creditCardId)} />
                            <DetailItem
                                label="Statement"
                                value={
                                    detailRow.statement ? (
                                        <button
                                            type="button"
                                            className="text-brand-secondary hover:underline"
                                            onClick={() => openStatementPreview(detailRow.statement)}
                                        >
                                            View statement
                                        </button>
                                    ) : (
                                        "—"
                                    )
                                }
                            />
                            <DetailItem
                                label="Receipt"
                                value={
                                    <ReceiptAction
                                        row={detailRow}
                                        busy={receiptBusyId === detailRow.id}
                                        onAttach={(file) => onAttachReceipt(detailRow, file)}
                                        onView={() => onViewReceipt(detailRow)}
                                        onRemove={() => onRemoveReceipt(detailRow)}
                                    />
                                }
                            />
                            {detailRow.notes && <DetailItem label="Notes" value={detailRow.notes} />}
                        </dl>
                    )}
                </SlideoutMenu.Content>
                {detailRow && (
                    <SlideoutMenu.Footer className="flex w-full items-center justify-end gap-2">
                        <Button
                            size="sm"
                            color="secondary"
                            iconLeading={Edit01}
                            onClick={() => {
                                const row = detailRow;
                                setDetailRow(null);
                                openEdit(row);
                            }}
                        >
                            Edit
                        </Button>
                        <Button size="sm" color="primary" onClick={() => setDetailRow(null)}>
                            Close
                        </Button>
                    </SlideoutMenu.Footer>
                )}
            </SlideoutMenu>

            <FormModal
                isOpen={!!receiptPreview}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setReceiptPreview(null);
                        setReceiptFileUrl(null);
                    }
                }}
                title={receiptPreview?.receiptFileName ?? "Receipt"}
            >
                {receiptPreview && (
                    <div className="flex flex-col gap-4">
                        <div className="flex h-[55vh] items-center justify-center overflow-hidden rounded-lg ring-1 ring-secondary ring-inset">
                            {receiptFileUrl ? <iframe src={receiptFileUrl} title={receiptPreview.receiptFileName ?? "Receipt"} className="size-full" /> : <p className="text-sm text-tertiary">Loading…</p>}
                        </div>
                        {receiptFileUrl && (
                            <div className="flex justify-end">
                                <Button color="secondary" href={receiptFileUrl} target="_blank">Open file</Button>
                            </div>
                        )}
                    </div>
                )}
            </FormModal>

            {/* Statement preview modal */}
            <FormModal
                isOpen={!!stmtPreview}
                onOpenChange={(o) => {
                    if (!o) {
                        setStmtPreview(null);
                        setStmtFileUrl(null);
                    }
                }}
                title="Statement preview"
            >
                {stmtPreview && (
                    <div className="flex flex-col gap-4">
                        <div className="flex h-[55vh] items-center justify-center overflow-hidden rounded-lg ring-1 ring-secondary ring-inset">
                            {stmtFileUrl ? <iframe src={stmtFileUrl} title={stmtPreview.fileName} className="size-full" /> : <p className="text-sm text-tertiary">Loading…</p>}
                        </div>
                        <div className="flex justify-end gap-2">
                            {stmtFileUrl && (
                                <Button color="secondary" href={stmtFileUrl} target="_blank">
                                    Open file
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </FormModal>
        </div>
    );
}

/** Inline fragment wrapper so grouped rows can share a key. */
function FragmentGroup({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-tertiary">{label}</dt>
            <dd className="max-w-[60%] text-right font-medium text-primary">{value}</dd>
        </div>
    );
}
