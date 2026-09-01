"use client";

import { useState } from "react";
import { Edit01, Gift01, Plus, Star01, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import {
    addCardPerk,
    addCardReward,
    deleteCardPerk,
    deleteCardReward,
    updateCardPerk,
    updateCardReward,
} from "@/lib/actions/financial-cards";
import { Card, EmptyState, Field, NativeInput, NativeSelect, NativeTextarea } from "../../_components/financial-ui";
import { FormModal } from "../../_components/form-modal";
import { useConfirm } from "../../_components/confirm-modal";
import { formatRewardRate, rewardSortKey, type RewardType } from "../../_components/reward-format";

export interface CardRewardRow {
    id: string;
    category: string;
    type: RewardType;
    rate: number;
    cap: string | null;
    notes: string | null;
}

export interface CardPerkRow {
    id: string;
    title: string;
    description: string | null;
}

const REWARD_TYPES: { value: RewardType; label: string }[] = [
    { value: "PERCENT", label: "% back" },
    { value: "POINTS", label: "Points (×)" },
    { value: "MILES", label: "Miles (×)" },
    { value: "CASHBACK", label: "Cash back ($)" },
];

const COMMON_CATEGORIES = [
    "Dining",
    "Groceries",
    "Gas",
    "Travel",
    "Transit",
    "Streaming",
    "Online shopping",
    "Drugstores",
    "Everything else",
];

export function RewardsPerksClient({ cardId, rewards, perks }: { cardId: string; rewards: CardRewardRow[]; perks: CardPerkRow[] }) {
    const { confirm, dialog } = useConfirm();

    const [rewardOpen, setRewardOpen] = useState(false);
    const [editingReward, setEditingReward] = useState<CardRewardRow | null>(null);
    const [perkOpen, setPerkOpen] = useState(false);
    const [editingPerk, setEditingPerk] = useState<CardPerkRow | null>(null);

    // Best/marquee reward = highest sort key (rate normalized by type).
    const sorted = [...rewards].sort((a, b) => rewardSortKey(b) - rewardSortKey(a));
    const marquee = sorted[0] ?? null;

    function openCreateReward() {
        setEditingReward(null);
        setRewardOpen(true);
    }
    function openEditReward(r: CardRewardRow) {
        setEditingReward(r);
        setRewardOpen(true);
    }
    async function onSubmitReward(fd: FormData) {
        try {
            if (editingReward) await updateCardReward(fd);
            else await addCardReward(fd);
            toast.success(editingReward ? "Reward updated" : "Reward added");
            setRewardOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    function onDeleteReward(r: CardRewardRow) {
        confirm({
            title: "Delete reward?",
            description: `Remove the “${r.category}” reward from this card. This can’t be undone.`,
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", r.id);
                try {
                    await deleteCardReward(fd);
                    toast.success("Reward deleted");
                } catch {
                    toast.error("Failed to delete");
                }
            },
        });
    }

    function openCreatePerk() {
        setEditingPerk(null);
        setPerkOpen(true);
    }
    function openEditPerk(p: CardPerkRow) {
        setEditingPerk(p);
        setPerkOpen(true);
    }
    async function onSubmitPerk(fd: FormData) {
        try {
            if (editingPerk) await updateCardPerk(fd);
            else await addCardPerk(fd);
            toast.success(editingPerk ? "Perk updated" : "Perk added");
            setPerkOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    function onDeletePerk(p: CardPerkRow) {
        confirm({
            title: "Delete perk?",
            description: `Remove “${p.title}” from this card. This can’t be undone.`,
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", p.id);
                try {
                    await deleteCardPerk(fd);
                    toast.success("Perk deleted");
                } catch {
                    toast.error("Failed to delete");
                }
            },
        });
    }

    return (
        <>
            {/* Rewards */}
            <Card className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-md font-semibold text-primary">Rewards</h3>
                    <Button size="sm" iconLeading={Plus} onClick={openCreateReward}>
                        Add reward
                    </Button>
                </div>

                {marquee && (
                    <div className="flex items-center gap-3 rounded-xl bg-brand-primary px-4 py-3 ring-1 ring-brand ring-inset">
                        <Star01 className="size-5 shrink-0 text-fg-brand-primary" aria-hidden="true" />
                        <div className="flex flex-col">
                            <span className="text-xs font-medium tracking-wide text-brand-secondary uppercase">Top reward</span>
                            <span className="text-sm font-semibold text-primary">
                                {formatRewardRate(marquee)} on {marquee.category}
                            </span>
                        </div>
                    </div>
                )}

                {rewards.length === 0 ? (
                    <EmptyState
                        icon={Star01}
                        title="Map out this card's rewards"
                        description="Add earn rates for Dining, Groceries, Travel and more to see which card pays you most on every purchase."
                        action={
                            <Button size="sm" iconLeading={Plus} onClick={openCreateReward}>
                                Add reward
                            </Button>
                        }
                    />
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary">
                        {sorted.map((r) => (
                            <li key={r.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge size="sm" color="gray">
                                            {r.category}
                                        </Badge>
                                        <span className="text-sm font-semibold text-brand-secondary">{formatRewardRate(r)}</span>
                                    </div>
                                    {r.cap && <p className="text-xs text-tertiary">{r.cap}</p>}
                                    {r.notes && <p className="text-xs whitespace-pre-wrap text-tertiary">{r.notes}</p>}
                                </div>
                                <div className="flex shrink-0 gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEditReward(r)} aria-label="Edit reward" />
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDeleteReward(r)} aria-label="Delete reward" />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {/* Perks */}
            <Card className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-md font-semibold text-primary">Perks</h3>
                    <Button size="sm" iconLeading={Plus} onClick={openCreatePerk}>
                        Add perk
                    </Button>
                </div>

                {perks.length === 0 ? (
                    <EmptyState
                        icon={Gift01}
                        title="Never leave a benefit on the table"
                        description="Track perks like lounge access, annual travel credits and purchase insurance so you actually use what you're paying for."
                        action={
                            <Button size="sm" iconLeading={Plus} onClick={openCreatePerk}>
                                Add perk
                            </Button>
                        }
                    />
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary">
                        {perks.map((p) => (
                            <li key={p.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                <div className="flex items-start gap-3">
                                    <Gift01 className="mt-0.5 size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                    <div className="flex flex-col gap-0.5">
                                        <p className="text-sm font-medium text-primary">{p.title}</p>
                                        {p.description && <p className="text-xs whitespace-pre-wrap text-tertiary">{p.description}</p>}
                                    </div>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEditPerk(p)} aria-label="Edit perk" />
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDeletePerk(p)} aria-label="Delete perk" />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {/* Reward modal */}
            <FormModal isOpen={rewardOpen} onOpenChange={setRewardOpen} title={editingReward ? "Edit reward" : "Add reward"}>
                <form action={onSubmitReward} className="flex flex-col gap-4" key={editingReward?.id ?? "new-reward"}>
                    <input type="hidden" name="creditCardId" value={cardId} />
                    {editingReward && <input type="hidden" name="id" value={editingReward.id} />}

                    <Field label="Category" htmlFor="category" hint="Pick a common one or type your own.">
                        <NativeInput
                            id="category"
                            name="category"
                            list="reward-categories"
                            required
                            defaultValue={editingReward?.category ?? ""}
                            placeholder="e.g. Dining"
                            autoComplete="off"
                        />
                        <datalist id="reward-categories">
                            {COMMON_CATEGORIES.map((c) => (
                                <option key={c} value={c} />
                            ))}
                        </datalist>
                    </Field>

                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Type" htmlFor="type">
                            <NativeSelect id="type" name="type" defaultValue={editingReward?.type ?? "PERCENT"}>
                                {REWARD_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Rate" htmlFor="rate" hint="e.g. 3 → 3% / 3×, $X for cash back">
                            <NativeInput id="rate" name="rate" type="number" step="0.01" min="0" required defaultValue={editingReward?.rate ?? ""} placeholder="3" />
                        </Field>
                    </div>

                    <Field label="Cap / condition" htmlFor="cap" hint="Optional, free text.">
                        <NativeInput id="cap" name="cap" defaultValue={editingReward?.cap ?? ""} placeholder="e.g. up to $6,000/yr, then 1%" />
                    </Field>
                    <Field label="Notes" htmlFor="reward-notes">
                        <NativeTextarea id="reward-notes" name="notes" defaultValue={editingReward?.notes ?? ""} />
                    </Field>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setRewardOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editingReward ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            {/* Perk modal */}
            <FormModal isOpen={perkOpen} onOpenChange={setPerkOpen} title={editingPerk ? "Edit perk" : "Add perk"}>
                <form action={onSubmitPerk} className="flex flex-col gap-4" key={editingPerk?.id ?? "new-perk"}>
                    <input type="hidden" name="creditCardId" value={cardId} />
                    {editingPerk && <input type="hidden" name="id" value={editingPerk.id} />}

                    <Field label="Title" htmlFor="title">
                        <NativeInput id="title" name="title" required defaultValue={editingPerk?.title ?? ""} placeholder="e.g. Priority Pass lounge access" />
                    </Field>
                    <Field label="Description" htmlFor="description">
                        <NativeTextarea id="description" name="description" defaultValue={editingPerk?.description ?? ""} placeholder="Details, conditions, how to redeem…" />
                    </Field>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setPerkOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editingPerk ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            {dialog}
        </>
    );
}
