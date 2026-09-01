"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { setTransactionSplits } from "@/lib/actions/financial-splits";
import { formatCurrency } from "@/lib/financial/format";
import { FormModal } from "./form-modal";
import { NativeInput, NativeSelect } from "./financial-ui";

interface CategoryOpt {
    id: string;
    label: string;
}
export interface ExistingSplit {
    categoryId: string | null;
    amount: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function SplitModal({
    isOpen,
    onOpenChange,
    transactionId,
    total,
    categories,
    existingSplits,
}: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    transactionId: string;
    total: number;
    categories: CategoryOpt[];
    existingSplits: ExistingSplit[];
}) {
    const [pending, start] = useTransition();
    const [rows, setRows] = useState<{ categoryId: string; amount: string }[]>(() =>
        existingSplits.length > 0
            ? existingSplits.map((s) => ({ categoryId: s.categoryId ?? "", amount: String(s.amount) }))
            : [
                  { categoryId: "", amount: total.toFixed(2) },
                  { categoryId: "", amount: "0" },
              ],
    );

    const sum = useMemo(() => round(rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)), [rows]);
    const remaining = round(total - sum);

    const setRow = (i: number, patch: Partial<{ categoryId: string; amount: string }>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    const addRow = () => setRows((rs) => [...rs, { categoryId: "", amount: remaining !== 0 ? remaining.toFixed(2) : "0" }]);
    const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

    function save() {
        const clean = rows.map((r) => ({ categoryId: r.categoryId || null, amount: parseFloat(r.amount) || 0 })).filter((r) => r.amount !== 0);
        start(async () => {
            try {
                await setTransactionSplits(transactionId, clean);
                toast.success(clean.length ? "Transaction split saved" : "Split removed");
                onOpenChange(false);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't save the split.");
            }
        });
    }

    function clearSplit() {
        start(async () => {
            try {
                await setTransactionSplits(transactionId, []);
                toast.success("Split removed");
                onOpenChange(false);
            } catch {
                toast.error("Couldn't remove the split.");
            }
        });
    }

    return (
        <FormModal isOpen={isOpen} onOpenChange={onOpenChange} title="Split transaction" description={`Divide ${formatCurrency(total)} across categories.`}>
            <div className="flex flex-col gap-3">
                {rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <NativeSelect value={r.categoryId} onChange={(e) => setRow(i, { categoryId: e.target.value })} className="flex-1">
                            <option value="">Uncategorized</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.label}
                                </option>
                            ))}
                        </NativeSelect>
                        <NativeInput type="number" step="0.01" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} className="w-32" />
                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => removeRow(i)} aria-label="Remove split" isDisabled={rows.length <= 1} />
                    </div>
                ))}

                <Button size="sm" color="secondary" iconLeading={Plus} onClick={addRow} className="self-start">
                    Add split
                </Button>

                <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${remaining === 0 ? "bg-success-secondary text-success-primary" : "bg-secondary text-secondary"}`}>
                    <span>Allocated {formatCurrency(sum)} of {formatCurrency(total)}</span>
                    <span className="font-medium tabular-nums">{remaining === 0 ? "Balanced" : `${formatCurrency(remaining)} left`}</span>
                </div>

                <div className="flex justify-between gap-2 pt-1">
                    <Button color="tertiary-destructive" onClick={clearSplit} isDisabled={pending || existingSplits.length === 0}>
                        Remove split
                    </Button>
                    <div className="flex gap-2">
                        <Button color="secondary" onClick={() => onOpenChange(false)} isDisabled={pending}>
                            Cancel
                        </Button>
                        <Button onClick={save} isLoading={pending} showTextWhileLoading>
                            Save split
                        </Button>
                    </div>
                </div>
            </div>
        </FormModal>
    );
}
