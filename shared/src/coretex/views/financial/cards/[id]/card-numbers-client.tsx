// @ts-nocheck


import { toast } from "sonner";
import { Button, Checkbox } from "react-aria-components";
import { useState } from "react";
import { formatDate } from "../../../personal/personal-ui";
import { Plus, CreditCard02, Check, Edit01, Trash02 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Card, EmptyRow, Field, NativeInput, NativeTextarea } from "../../_components/financial-ui";
import { FormModal } from "../../_components/form-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";

export interface CardNumberRow {
    id: string;
    last4: string;
    validFrom: string | null;
    validTo: string | null;
    isCurrent: boolean;
    notes: string | null;
}

export function CardNumbersClient({ cardId, numbers }: { cardId: string; numbers: CardNumberRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<CardNumberRow | null>(null);

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }

    function openEdit(row: CardNumberRow) {
        setEditing(row);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateCardNumber(fd);
            else await createCardNumber(fd);
            toast.success(editing ? "Card number updated" : "Card number added");
            setOpen(false);
            setEditing(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onCurrent(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await markCardNumberCurrent(fd);
            toast.success("Marked current");
        } catch {
            toast.error("Failed");
        }
    }
    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteCardNumber(fd);
            toast.success("Deleted");
        } catch {
            toast.error("Failed");
        }
    }

    return (
        <Card className="p-0">
            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                <h3 className="text-md font-semibold text-primary">Card number history</h3>
                <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                    Add number
                </Button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                    <thead>
                        <tr className="border-b border-secondary text-left text-tertiary">
                            <th className="px-5 py-3 font-medium">Last 4</th>
                            <th className="px-5 py-3 font-medium">Valid</th>
                            <th className="px-5 py-3 font-medium">Status</th>
                            <th className="px-5 py-3 font-medium">Notes</th>
                            <th className="px-5 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {numbers.length === 0 && (
                            <EmptyRow
                                colSpan={5}
                                icon={CreditCard02}
                                title="Track replacements over time"
                                description="Record each card number so reissues and lost cards stay linked to the same account history."
                                action={
                                    <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                        Add number
                                    </Button>
                                }
                            />
                        )}
                        {numbers.map((n) => (
                            <tr key={n.id} className="border-b border-secondary last:border-0">
                                <td className="px-5 py-3 font-medium text-primary">••{n.last4}</td>
                                <td className="px-5 py-3 text-tertiary">
                                    {n.validFrom || n.validTo ? `${formatDate(n.validFrom)} – ${n.validTo ? formatDate(n.validTo) : "present"}` : "—"}
                                </td>
                                <td className="px-5 py-3">
                                    {n.isCurrent ? (
                                        <Badge size="sm" color="success">
                                            Current
                                        </Badge>
                                    ) : (
                                        <Badge size="sm" color="gray">
                                            Old
                                        </Badge>
                                    )}
                                </td>
                                <td className="max-w-[200px] truncate px-5 py-3 text-tertiary">{n.notes}</td>
                                <td className="px-5 py-3">
                                    <div className="flex justify-end gap-1">
                                        {!n.isCurrent && <Button size="sm" color="tertiary" iconLeading={Check} onClick={() => onCurrent(n.id)} aria-label="Mark current" />}
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(n)} aria-label="Edit" />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(n.id)} aria-label="Delete" />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <FormModal
                isOpen={open}
                onOpenChange={(isOpen) => {
                    setOpen(isOpen);
                    if (!isOpen) setEditing(null);
                }}
                title={editing ? "Edit card number" : "Add card number"}
            >
                <form action={onSubmit} className="flex flex-col gap-4" key={editing?.id ?? "new"}>
                    <input type="hidden" name="creditCardId" value={cardId} />
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Last 4" htmlFor="last4">
                        <NativeInput id="last4" name="last4" maxLength={4} required placeholder="1234" defaultValue={editing?.last4 ?? ""} inputMode="numeric" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <FormDateInput name="validFrom" label="Valid from" defaultValue={editing?.validFrom ?? null} />
                        <FormDateInput name="validTo" label="Valid to" defaultValue={editing?.validTo ?? null} />
                    </div>
                    <Checkbox name="isCurrent" defaultSelected={editing ? editing.isCurrent : true} label="This is the current number" />
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            color="secondary"
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                setEditing(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </Card>
    );
}
