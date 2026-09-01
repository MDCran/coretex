"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Receipt, UploadCloud02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { createReceiptTransaction, discardPendingReceipt, scanReceipt, type ScanReceiptResult } from "@/lib/actions/financial-receipts";
import { FormModal } from "./form-modal";
import { Field, NativeInput, NativeSelect } from "./financial-ui";
import { ControlledDateInput } from "@/components/base/input/form-date-input";

interface OwnerOpt {
    id: string;
    label: string;
    kind: "account" | "card";
}
interface CategoryOpt {
    id: string;
    label: string;
}

const SAFE_RECEIPT_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const SAFE_RECEIPT_ACCEPT = Array.from(SAFE_RECEIPT_TYPES).join(",");
const MAX_RECEIPT_SIZE = 25 * 1024 * 1024;

export function ReceiptScanner({ owners, categories, disabled }: { owners: OwnerOpt[]; categories: CategoryOpt[]; disabled?: boolean }) {
    const [open, setOpen] = useState(false);
    const [scanning, startScan] = useTransition();
    const [saving, startSave] = useTransition();
    const fileRef = useRef<HTMLInputElement>(null);

    const [result, setResult] = useState<ScanReceiptResult | null>(null);
    const [merchant, setMerchant] = useState("");
    const [amount, setAmount] = useState("");
    const [date, setDate] = useState("");
    const [ownerId, setOwnerId] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const pendingReceiptKeyRef = useRef<string | null>(null);
    const scanRequestRef = useRef(0);

    useEffect(() => () => {
        scanRequestRef.current += 1;
        // Do not delete here: route navigation can unmount while the save
        // Server Action is still linking this key. Explicit Cancel and stale
        // scan results remain safe cleanup points.
    }, []);

    function reset(discardPending = false) {
        scanRequestRef.current += 1;
        const pendingKey = pendingReceiptKeyRef.current;
        pendingReceiptKeyRef.current = null;
        if (discardPending && pendingKey) void discardPendingReceipt(pendingKey).catch(() => {});
        setResult(null);
        setMerchant("");
        setAmount("");
        setDate("");
        setOwnerId("");
        setCategoryId("");
        if (fileRef.current) fileRef.current.value = "";
    }

    function onFile(file: File) {
        if (file.size === 0 || file.size > MAX_RECEIPT_SIZE) {
            toast.error(file.size === 0 ? "Choose a non-empty receipt image." : "Receipt image must be 25 MB or smaller.");
            return;
        }
        if (!SAFE_RECEIPT_TYPES.has(file.type.toLowerCase())) {
            toast.error("Choose an AVIF, GIF, JPEG, PNG, or WebP image.");
            return;
        }
        const fd = new FormData();
        fd.set("file", file);
        const requestId = ++scanRequestRef.current;
        startScan(async () => {
            try {
                const r = await scanReceipt(fd);
                if (requestId !== scanRequestRef.current) {
                    await discardPendingReceipt(r.receiptKey).catch(() => {});
                    return;
                }
                pendingReceiptKeyRef.current = r.receiptKey;
                setResult(r);
                setMerchant(r.merchant ?? "");
                setAmount(r.amount != null ? String(r.amount) : "");
                setDate(r.date ?? new Date().toISOString().slice(0, 10));
                // Best-effort category match by name.
                const match = r.category ? categories.find((c) => c.label.toLowerCase() === r.category!.toLowerCase()) : null;
                setCategoryId(match?.id ?? "");
                toast.success("Receipt scanned");
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't scan that receipt.");
            }
        });
    }

    function create() {
        const owner = owners.find((o) => o.id === ownerId);
        startSave(async () => {
            try {
                await createReceiptTransaction({
                    receiptKey: result!.receiptKey,
                    finAccountId: owner?.kind === "account" ? owner.id : null,
                    creditCardId: owner?.kind === "card" ? owner.id : null,
                    date: date || new Date().toISOString().slice(0, 10),
                    amount: parseFloat(amount) || 0,
                    merchant: merchant.trim() || null,
                    categoryId: categoryId || null,
                    notes: null,
                });
                toast.success("Transaction created from receipt");
                setOpen(false);
                reset();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't create the transaction.");
            }
        });
    }

    return (
        <>
            <Button color="secondary" iconLeading={Receipt} onClick={() => setOpen(true)} isDisabled={disabled}>
                Scan receipt
            </Button>

            <FormModal
                isOpen={open}
                isDismissable={!scanning && !saving}
                onOpenChange={(o) => {
                    if (!o && (scanning || saving)) return;
                    setOpen(o);
                    if (!o) reset(true);
                }}
                title="Scan a receipt"
                description="Snap or upload a receipt and we'll read the merchant, total and date."
            >
                <div className="flex flex-col gap-4">
                    {!result ? (
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            disabled={scanning}
                            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-secondary bg-secondary/40 px-6 py-10 text-center transition hover:bg-secondary disabled:opacity-60"
                        >
                            <UploadCloud02 className="size-7 text-fg-quaternary" />
                            <span className="text-sm font-medium text-secondary">{scanning ? "Reading receipt…" : "Tap to upload or take a photo"}</span>
                            <span className="text-xs text-tertiary">AVIF, GIF, JPEG, PNG or WebP · up to 25 MB</span>
                        </button>
                    ) : (
                        <div className="flex flex-col gap-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Merchant">
                                    <NativeInput value={merchant} onChange={(e) => setMerchant(e.target.value)} />
                                </Field>
                                <Field label="Amount">
                                    <NativeInput type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                                </Field>
                                <Field label="Date">
                                    <ControlledDateInput variant="date" value={date || null} onChange={setDate} className="w-full" />
                                </Field>
                                <Field label="Account / card">
                                    <NativeSelect value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                                        <option value="">Select…</option>
                                        {owners.map((o) => (
                                            <option key={o.id} value={o.id}>
                                                {o.label}
                                            </option>
                                        ))}
                                    </NativeSelect>
                                </Field>
                                <Field label="Category" className="sm:col-span-2">
                                    <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                                        <option value="">Uncategorized</option>
                                        {categories.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.label}
                                            </option>
                                        ))}
                                    </NativeSelect>
                                </Field>
                            </div>
                            <div className="flex justify-between gap-2">
                                <Button color="tertiary" onClick={() => reset(true)} isDisabled={saving}>
                                    Rescan
                                </Button>
                                <Button onClick={create} isLoading={saving} showTextWhileLoading isDisabled={!ownerId || !amount}>
                                    Create transaction
                                </Button>
                            </div>
                        </div>
                    )}

                    <input
                        ref={fileRef}
                        type="file"
                        accept={SAFE_RECEIPT_ACCEPT}
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.currentTarget.value = "";
                            if (f) onFile(f);
                        }}
                    />
                </div>
            </FormModal>
        </>
    );
}
