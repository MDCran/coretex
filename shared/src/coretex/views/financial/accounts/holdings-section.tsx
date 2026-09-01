// @ts-nocheck


import { Card, EmptyRow, Field, NativeInput } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { Plus, TrendUp01, Edit01, Trash02 } from "@untitledui/icons";
import { useState } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";
import { formatCurrency } from "../../personal/personal-ui";

export interface HoldingRow {
    id: string;
    symbol: string;
    shares: number;
    costBasisPerShare: number | null;
    currentPrice: number | null;
    asOf: string | null;
}

/**
 * Holdings table + add/edit/delete modals for a BROKERAGE account. Holdings are
 * stored on the FinAccount; balance is recomputed server-side on every change.
 */
export function HoldingsSection({ finAccountId, holdings, readOnlyNote }: { finAccountId: string; holdings: HoldingRow[]; readOnlyNote?: string }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<HoldingRow | null>(null);
    const { confirm, dialog } = useConfirm();

    const totalCost = holdings.reduce((s, h) => s + (h.costBasisPerShare ?? 0) * h.shares, 0);
    const totalMarket = holdings.reduce((s, h) => s + (h.currentPrice ?? 0) * h.shares, 0);
    const totalGain = totalMarket - totalCost;

    async function onSubmit(fd: FormData) {
        fd.set("finAccountId", finAccountId);
        try {
            if (editing) await updateAccountHolding(fd);
            else await createAccountHolding(fd);
            toast.success(editing ? "Holding updated" : "Holding added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    function onDelete(h: HoldingRow) {
        confirm({
            title: "Delete holding?",
            description: `Remove ${h.symbol} from this account? This can’t be undone.`,
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", h.id);
                try {
                    await deleteAccountHolding(fd);
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed to delete");
                }
            },
        });
    }

    return (
        <Card className="flex flex-col gap-4 p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-secondary px-5 py-4">
                <div className="flex flex-col gap-0.5">
                    <h3 className="text-md font-semibold text-primary">Holdings</h3>
                    {totalCost > 0 ? (
                        <p className="text-xs text-tertiary">
                            Market {formatCurrency(totalMarket)} ·{" "}
                            <span className={totalGain >= 0 ? "text-success-primary" : "text-error-primary"}>
                                {totalGain >= 0 ? "+" : ""}
                                {formatCurrency(totalGain)}
                            </span>{" "}
                            unrealized
                        </p>
                    ) : (
                        readOnlyNote && <p className="text-xs text-tertiary">{readOnlyNote}</p>
                    )}
                </div>
                <Button
                    size="sm"
                    color="secondary"
                    iconLeading={Plus}
                    onClick={() => {
                        setEditing(null);
                        setOpen(true);
                    }}
                >
                    Add holding
                </Button>
            </div>

            <div className="-mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                    <thead>
                        <tr className="border-b border-secondary text-left text-tertiary">
                            <th className="px-5 py-3 font-medium">Symbol</th>
                            <th className="px-5 py-3 text-right font-medium">Shares</th>
                            <th className="px-5 py-3 text-right font-medium">Cost / sh</th>
                            <th className="px-5 py-3 text-right font-medium">Price</th>
                            <th className="px-5 py-3 text-right font-medium">Market value</th>
                            <th className="px-5 py-3 text-right font-medium">Gain/loss</th>
                            <th className="px-5 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {holdings.length === 0 && (
                            <EmptyRow
                                colSpan={7}
                                icon={TrendUp01}
                                title="Track what you own"
                                description="Add a holding by hand, link Alpaca, or extract positions from a statement to value this account in real time."
                                action={
                                    <Button
                                        size="sm"
                                        iconLeading={Plus}
                                        onClick={() => {
                                            setEditing(null);
                                            setOpen(true);
                                        }}
                                    >
                                        Add holding
                                    </Button>
                                }
                            />
                        )}
                        {holdings.map((h) => {
                            const mv = (h.currentPrice ?? 0) * h.shares;
                            const cost = (h.costBasisPerShare ?? 0) * h.shares;
                            const gl = mv - cost;
                            return (
                                <tr key={h.id} className="border-b border-secondary last:border-0">
                                    <td className="px-5 py-3 font-medium text-primary">{h.symbol}</td>
                                    <td className="px-5 py-3 text-right text-secondary tabular-nums">{h.shares}</td>
                                    <td className="px-5 py-3 text-right text-tertiary tabular-nums">{h.costBasisPerShare != null ? formatCurrency(h.costBasisPerShare) : "—"}</td>
                                    <td className="px-5 py-3 text-right text-tertiary tabular-nums">{h.currentPrice != null ? formatCurrency(h.currentPrice) : "—"}</td>
                                    <td className="px-5 py-3 text-right font-medium text-primary tabular-nums">{formatCurrency(mv)}</td>
                                    <td className={`px-5 py-3 text-right font-medium tabular-nums ${gl >= 0 ? "text-success-primary" : "text-error-primary"}`}>
                                        {h.costBasisPerShare != null ? (
                                            <>
                                                {gl >= 0 ? "+" : ""}
                                                {formatCurrency(gl)}
                                                {cost > 0 && <span className="ml-1 text-xs opacity-80">({gl >= 0 ? "+" : ""}{((gl / cost) * 100).toFixed(1)}%)</span>}
                                            </>
                                        ) : (
                                            "—"
                                        )}
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                size="sm"
                                                color="tertiary"
                                                iconLeading={Edit01}
                                                onClick={() => {
                                                    setEditing(h);
                                                    setOpen(true);
                                                }}
                                                aria-label="Edit holding"
                                            />
                                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(h)} aria-label="Delete holding" />
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit holding" : "Add holding"}>
                <form action={onSubmit} className="flex flex-col gap-4" key={editing?.id ?? "new"}>
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Symbol" htmlFor="symbol">
                            <NativeInput id="symbol" name="symbol" required defaultValue={editing?.symbol ?? ""} placeholder="AAPL" />
                        </Field>
                        <Field label="Shares" htmlFor="shares">
                            <NativeInput id="shares" name="shares" type="number" step="any" required defaultValue={editing?.shares ?? ""} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Cost basis / share" htmlFor="costBasisPerShare">
                            <NativeInput id="costBasisPerShare" name="costBasisPerShare" type="number" step="any" defaultValue={editing?.costBasisPerShare ?? ""} />
                        </Field>
                        <Field label="Current price" htmlFor="currentPrice">
                            <NativeInput id="currentPrice" name="currentPrice" type="number" step="any" defaultValue={editing?.currentPrice ?? ""} />
                        </Field>
                    </div>
                    <FormDateInput name="asOf" label="As of" defaultValue={editing?.asOf ? editing.asOf.slice(0, 10) : ""} />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            {dialog}
        </Card>
    );
}
