"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy01, Maximize01, Minimize01, Plus, Scissors01, Trash01 } from "@untitledui/icons";
import type { Block, Peptide } from "@/lib/peptides/types";
import { deriveBlock, FREQUENCY_PRESETS, mgToUnit } from "@/lib/peptides/dosing";
import { fmt, fmtUnits } from "@/lib/peptides/format";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { cx } from "@/utils/cx";
import { Card, CardBody, CardHeader, CardTitle } from "./card";
import { EmptyState } from "./empty-state";
import { Field, FieldInput, FieldSelect, NumberInput } from "./field-controls";
import { ConfirmModal } from "./confirm-modal";
import { detectBlockConflicts } from "./block-conflicts";

interface Props {
    peptide: Peptide;
    onAddBlock: () => void;
    onUpdateBlock: (blockId: string, patch: Partial<Block>) => void;
    onRemoveBlock: (blockId: string) => void;
    onDuplicateBlock: (blockId: string) => void;
    onResizeBlock: (blockId: string, delta: number) => void;
    onSplitBlock: (blockId: string, week: number) => void;
    /** Block id to scroll to / flash, set by the timeline. */
    focusBlockId?: string | null;
    onFocusHandled?: () => void;
}

function freqValue(n: number): string {
    return FREQUENCY_PRESETS.some((p) => p.value === n) ? String(n) : "custom";
}

const FREQ_OPTIONS = [...FREQUENCY_PRESETS.map((p) => ({ value: String(p.value), label: p.label })), { value: "custom", label: "Custom…" }];

function weeksLabel(b: Block): string {
    return b.startWeek === b.endWeek ? `Week ${b.startWeek}` : `Weeks ${b.startWeek}–${b.endWeek}`;
}

export function CyclePlanTable({
    peptide,
    onAddBlock,
    onUpdateBlock,
    onRemoveBlock,
    onDuplicateBlock,
    onResizeBlock,
    onSplitBlock,
    focusBlockId,
    onFocusHandled,
}: Props) {
    const u = peptide.doseUnit;
    const [removing, setRemoving] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    // Blocks ordered by week for clear week-by-week continuity (auto-sorted on display).
    const ordered = useMemo(
        () => [...peptide.blocks].sort((a, b) => a.startWeek - b.startWeek || a.endWeek - b.endWeek),
        [peptide.blocks],
    );

    // Overlap / gap / invalid-range detection across the whole plan.
    const conflicts = useMemo(() => detectBlockConflicts(peptide.blocks), [peptide.blocks]);

    /**
     * Suggested fix for an overlapping block: push its startWeek to one past the
     * previous (by week) block's endWeek so the ranges no longer collide.
     */
    const fixOverlap = (b: Block) => {
        const prior = ordered.filter((x) => x.id !== b.id && x.startWeek <= b.startWeek && x.endWeek >= b.startWeek);
        const priorEnd = prior.reduce((m, x) => Math.max(m, x.endWeek), 0);
        const newStart = Math.max(priorEnd + 1, b.startWeek);
        const newEnd = Math.max(newStart, b.endWeek);
        onUpdateBlock(b.id, { startWeek: newStart, endWeek: newEnd });
    };

    // Scroll-to / flash the block requested from the timeline.
    useEffect(() => {
        if (!focusBlockId) return;
        const el = rowRefs.current.get(focusBlockId);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            setFlash(focusBlockId);
            const t = setTimeout(() => setFlash(null), 1200);
            onFocusHandled?.();
            return () => clearTimeout(t);
        }
        onFocusHandled?.();
    }, [focusBlockId, onFocusHandled]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Cycle plan — week by week</CardTitle>
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={onAddBlock}>
                    Add block
                </Button>
            </CardHeader>
            <CardBody className="space-y-3">
                {ordered.length === 0 && (
                    <EmptyState
                        icon={Plus}
                        size="sm"
                        title="Add your first block"
                        description="Blocks define dose and frequency for a range of weeks."
                        actionLabel="Add your first block"
                        actionIcon={Plus}
                        onAction={onAddBlock}
                    />
                )}

                {(conflicts.overlapMessages.length > 0 || conflicts.gapMessages.length > 0) && (
                    <div
                        className={cx(
                            "flex items-start gap-3 rounded-xl p-4 ring-1",
                            conflicts.hasOverlap ? "bg-error-primary/5 ring-error_subtle" : "bg-warning-primary/5 ring-warning",
                        )}
                    >
                        <AlertTriangle
                            className={cx("mt-0.5 size-4 shrink-0", conflicts.hasOverlap ? "text-fg-error-secondary" : "text-fg-warning-secondary")}
                            aria-hidden="true"
                        />
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <p className={cx("text-sm font-semibold", conflicts.hasOverlap ? "text-error-primary" : "text-warning-primary")}>
                                {conflicts.hasOverlap ? "Plan has overlapping blocks" : "Plan has gaps"}
                            </p>
                            {conflicts.overlapMessages.map((m) => (
                                <p key={`o-${m}`} className="text-sm text-error-primary">
                                    {m}.
                                </p>
                            ))}
                            {conflicts.gapMessages.map((m) => (
                                <p key={`g-${m}`} className="text-sm text-tertiary">
                                    {m}.
                                </p>
                            ))}
                        </div>
                    </div>
                )}

                {ordered.map((b) => {
                    const d = deriveBlock(b, peptide);
                    const badRange = b.endWeek < b.startWeek;
                    const isOverlapping = conflicts.overlapping.has(b.id);
                    const splitWeek = b.startWeek + 1;
                    const canSplit = b.endWeek > b.startWeek;
                    return (
                        <div
                            key={b.id}
                            ref={(el) => {
                                if (el) rowRefs.current.set(b.id, el);
                                else rowRefs.current.delete(b.id);
                            }}
                            className={cx(
                                "group relative rounded-xl bg-secondary/40 p-4 ring-1 ring-secondary transition duration-100 ease-linear",
                                (badRange || isOverlapping) && "ring-error",
                                flash === b.id && "ring-2 ring-brand",
                            )}
                        >
                            <div className="mb-3 flex h-7 items-center justify-between">
                                <span className="text-xs font-semibold tracking-wider text-secondary uppercase">{weeksLabel(b)}</span>
                                <div className="flex items-center gap-1 opacity-100 transition duration-100 ease-linear focus-within:opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                                    <ButtonUtility size="xs" color="tertiary" icon={Minimize01} tooltip="Shrink 1 week" onClick={() => onResizeBlock(b.id, -1)} />
                                    <ButtonUtility size="xs" color="tertiary" icon={Maximize01} tooltip="Extend 1 week" onClick={() => onResizeBlock(b.id, 1)} />
                                    <ButtonUtility
                                        size="xs"
                                        color="tertiary"
                                        icon={Scissors01}
                                        tooltip={canSplit ? `Split at week ${splitWeek}` : "Need 2+ weeks to split"}
                                        isDisabled={!canSplit}
                                        onClick={() => onSplitBlock(b.id, splitWeek)}
                                    />
                                    <ButtonUtility size="xs" color="tertiary" icon={Copy01} tooltip="Duplicate after this block" onClick={() => onDuplicateBlock(b.id)} />
                                    <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Delete block" onClick={() => setRemoving(b.id)} />
                                </div>
                            </div>

                            {isOverlapping && (
                                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-error-primary/5 px-3 py-2 ring-1 ring-error_subtle">
                                    <span className="flex items-center gap-2 text-xs font-medium text-error-primary">
                                        <AlertTriangle className="size-3.5 shrink-0 text-fg-error-secondary" aria-hidden="true" />
                                        Overlaps another block&apos;s weeks.
                                    </span>
                                    <Button size="xs" color="secondary" onClick={() => fixOverlap(b)}>
                                        Fix
                                    </Button>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                                <Field label="Start week" warn={isOverlapping ? "overlap" : undefined}>
                                    <NumberInput
                                        value={b.startWeek}
                                        min={1}
                                        step={1}
                                        isInvalid={isOverlapping}
                                        aria-label="Start week"
                                        onChange={(v) => onUpdateBlock(b.id, { startWeek: v })}
                                    />
                                </Field>
                                <Field label="End week" warn={badRange ? "< start" : undefined}>
                                    <NumberInput
                                        value={b.endWeek}
                                        min={1}
                                        step={1}
                                        isInvalid={badRange}
                                        aria-label="End week"
                                        onChange={(v) => onUpdateBlock(b.id, { endWeek: v })}
                                    />
                                </Field>
                                <Field label={`Dose (${u})`}>
                                    <NumberInput
                                        value={b.dosePerAdmin}
                                        min={0}
                                        step={u === "mcg" ? 5 : 0.5}
                                        aria-label="Dose per administration"
                                        onChange={(v) => onUpdateBlock(b.id, { dosePerAdmin: v })}
                                    />
                                </Field>
                                <Field label="Frequency">
                                    <FieldSelect
                                        value={freqValue(b.dosesPerWeek)}
                                        options={FREQ_OPTIONS}
                                        aria-label="Frequency preset"
                                        onChange={(v) => {
                                            if (v !== "custom") onUpdateBlock(b.id, { dosesPerWeek: Number(v) });
                                        }}
                                    />
                                </Field>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr]">
                                {freqValue(b.dosesPerWeek) === "custom" && (
                                    <Field label="Doses / week" className="w-32">
                                        <NumberInput value={b.dosesPerWeek} min={0} step={0.5} aria-label="Doses per week" onChange={(v) => onUpdateBlock(b.id, { dosesPerWeek: v })} />
                                    </Field>
                                )}
                                <Field label="Timing note" className="min-w-0 flex-1">
                                    <FieldInput
                                        value={b.note ?? ""}
                                        placeholder="e.g. morning, after workout"
                                        aria-label="Timing note"
                                        onChange={(v) => onUpdateBlock(b.id, { note: v })}
                                    />
                                </Field>
                            </div>

                            {/* Derived figures */}
                            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-secondary pt-3 text-xs text-tertiary">
                                <span>
                                    Units/dose <span className="font-mono font-medium text-secondary tabular-nums">{d.mlPerAdmin > 0 ? `${fmtUnits(d.unitsPerAdmin)}u` : "—"}</span>
                                </span>
                                <span>
                                    Admins <span className="font-mono font-medium text-secondary tabular-nums">{fmt(d.totalAdmins, 1)}</span>
                                </span>
                                <span>
                                    Block total{" "}
                                    <span className="font-mono font-medium text-secondary tabular-nums">
                                        {fmt(mgToUnit(d.totalDoseMg, u), 2)} {u}
                                    </span>
                                </span>
                            </div>
                        </div>
                    );
                })}

                {ordered.length > 0 && (
                    <button
                        type="button"
                        onClick={onAddBlock}
                        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-secondary py-3 text-sm font-medium text-tertiary transition duration-100 ease-linear hover:border-brand hover:bg-brand-primary/5 hover:text-brand-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                        <Plus className="size-4" aria-hidden="true" />
                        Add block
                    </button>
                )}
            </CardBody>

            <ConfirmModal
                isOpen={removing !== null}
                onOpenChange={(open) => !open && setRemoving(null)}
                title="Delete block?"
                description="This removes the dosing block from the cycle plan."
                confirmLabel="Delete block"
                destructive
                onConfirm={() => {
                    if (removing) onRemoveBlock(removing);
                    setRemoving(null);
                }}
            />
        </Card>
    );
}
