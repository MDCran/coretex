"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, Plus, SearchLg, SearchRefraction, X, Zap } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { EQUIPMENT_OPTIONS, MUSCLE_GROUPS, titleCase } from "@/lib/workouts";
import { cx } from "@/utils/cx";
import { EmptyState, Field, NativeInput, NativeSelect } from "../../_components/workouts-ui";

const DENSITY_COLS: Record<number, string> = {
    2: "sm:grid-cols-2",
    3: "lg:grid-cols-3",
    4: "lg:grid-cols-4",
};

export type ExerciseLibraryItem = {
    id: string;
    name: string;
    slug: string;
    muscles: string[];
    equipment: string[];
    level: string | null;
    category: string | null;
    image: string | null;
    mine: boolean;
    tracksReps?: boolean;
    tracksWeight?: boolean;
    tracksTime?: boolean;
    tracksDistance?: boolean;
};

function measureHint(e: Pick<ExerciseLibraryItem, "tracksReps" | "tracksWeight" | "tracksTime" | "tracksDistance">): string {
    const parts: string[] = [];
    if (e.tracksReps) parts.push("Reps");
    if (e.tracksWeight) parts.push("Weight");
    if (e.tracksTime) parts.push("Time");
    if (e.tracksDistance) parts.push("Distance");
    return parts.length ? parts.join(" + ") : "Custom";
}

type GridProps = {
    exercises: ExerciseLibraryItem[];
    density?: 2 | 3 | 4;
    showFilters?: boolean;
    /** Highlight exercises already in the workout/template */
    existingIds?: string[];
    /** Last-done summary for picker context */
    lastDone?: Record<string, { date: string; topSet: string | null }>;
    onSelect?: (id: string) => void;
    onCreate?: (name: string) => void;
    /** Quick-log a standalone attempt from the library grid (exercises tab). */
    onLogAttempt?: (exercise: ExerciseLibraryItem) => void;
};

export function ExerciseLibraryGrid({
    exercises,
    density = 3,
    showFilters = true,
    existingIds = [],
    lastDone = {},
    onSelect,
    onCreate,
    onLogAttempt,
}: GridProps) {
    const [q, setQ] = useState("");
    const [muscle, setMuscle] = useState("");
    const [equipment, setEquipment] = useState("");
    const [level, setLevel] = useState("");
    const [scope, setScope] = useState("");
    const existing = useMemo(() => new Set(existingIds), [existingIds]);

    const filtered = useMemo(() => {
        const query = q.trim().toLowerCase();
        return exercises.filter((e) => {
            if (query && !e.name.toLowerCase().includes(query) && !e.muscles.some((m) => m.includes(query))) return false;
            if (muscle && !e.muscles.includes(muscle)) return false;
            if (equipment && !e.equipment.includes(equipment)) return false;
            if (level && e.level !== level) return false;
            if (scope === "mine" && !e.mine) return false;
            if (scope === "global" && e.mine) return false;
            return true;
        });
    }, [exercises, q, muscle, equipment, level, scope]);

    const createName = q.trim();
    const showCreate = Boolean(onCreate && createName && !exercises.some((e) => e.name.toLowerCase() === createName.toLowerCase()));

    const card = (e: ExerciseLibraryItem) => {
        const done = lastDone[e.id];
        const already = existing.has(e.id);
        const inner = (
            <>
                {e.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.image} alt={e.name} loading="lazy" className="aspect-video w-full bg-secondary object-cover" />
                ) : (
                    <div className="flex aspect-video w-full items-center justify-center bg-secondary">
                        <FeaturedIcon icon={Activity} color="gray" theme="modern" size="lg" />
                    </div>
                )}
                <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-semibold text-primary">{e.name}</p>
                        {e.mine && (
                            <Badge color="brand" size="sm">
                                Custom
                            </Badge>
                        )}
                    </div>
                    {e.muscles.length > 0 && <p className="truncate text-xs text-tertiary">{e.muscles.slice(0, 3).map(titleCase).join(" · ")}</p>}
                    <div className="flex flex-wrap gap-1">
                        <Badge color="gray" size="sm" type="modern">
                            {measureHint(e)}
                        </Badge>
                        {e.equipment.slice(0, 1).map((eq) => (
                            <Badge key={eq} color="gray" size="sm" type="modern">
                                {titleCase(eq)}
                            </Badge>
                        ))}
                    </div>
                    {done && (
                        <p className="mt-auto text-[10px] text-quaternary">
                            Last: {done.topSet ?? "—"} · {new Date(`${done.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </p>
                    )}
                    {already && <p className="text-[10px] font-medium text-warning-primary">Already added</p>}
                </div>
            </>
        );

        const className = cx(
            "flex flex-col overflow-hidden rounded-xl bg-primary text-left ring-1 ring-secondary ring-inset transition duration-100 ease-linear",
            onSelect ? "cursor-pointer hover:bg-secondary_hover hover:ring-brand" : "hover:bg-secondary_hover",
            already && onSelect && "opacity-70",
        );

        if (onSelect) {
            return (
                <button key={e.id} type="button" onClick={() => onSelect(e.id)} className={className}>
                    {inner}
                </button>
            );
        }

        if (onLogAttempt) {
            return (
                <div key={e.id} className={cx(className, "group relative")}>
                    <Link href={`/workouts/exercises/${e.slug}`} className="flex min-h-0 flex-1 flex-col">
                        {inner}
                    </Link>
                    <div className="absolute right-2 bottom-2 opacity-0 transition group-hover:opacity-100">
                        <Button
                            size="sm"
                            color="primary"
                            iconLeading={<Zap data-icon className="size-3.5" />}
                            onClick={(ev: React.MouseEvent) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                onLogAttempt(e);
                            }}
                        >
                            Log attempt
                        </Button>
                    </div>
                </div>
            );
        }

        return (
            <Link key={e.id} href={`/workouts/exercises/${e.slug}`} className={className}>
                {inner}
            </Link>
        );
    };

    return (
        <div className="flex flex-col gap-4">
            {showFilters && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Field label="" className="lg:col-span-1">
                        <div className="relative">
                            <SearchLg className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-quaternary" />
                            <NativeInput value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search exercises…" className="pl-9" />
                        </div>
                    </Field>
                    <NativeSelect value={muscle} onChange={(ev) => setMuscle(ev.target.value)}>
                        <option value="">All muscles</option>
                        {MUSCLE_GROUPS.map((m) => (
                            <option key={m} value={m}>
                                {titleCase(m)}
                            </option>
                        ))}
                    </NativeSelect>
                    <NativeSelect value={equipment} onChange={(ev) => setEquipment(ev.target.value)}>
                        <option value="">All equipment</option>
                        {EQUIPMENT_OPTIONS.map((eq) => (
                            <option key={eq} value={eq}>
                                {titleCase(eq)}
                            </option>
                        ))}
                    </NativeSelect>
                    <NativeSelect value={level} onChange={(ev) => setLevel(ev.target.value)}>
                        <option value="">All levels</option>
                        <option value="BEGINNER">Beginner</option>
                        <option value="INTERMEDIATE">Intermediate</option>
                        <option value="EXPERT">Expert</option>
                    </NativeSelect>
                    <NativeSelect value={scope} onChange={(ev) => setScope(ev.target.value)}>
                        <option value="">Global + mine</option>
                        <option value="mine">Mine only</option>
                        <option value="global">Global only</option>
                    </NativeSelect>
                </div>
            )}

            <p className="text-sm text-tertiary">
                <span className="font-medium text-secondary">{filtered.length}</span> {filtered.length === 1 ? "exercise" : "exercises"}
            </p>

            {showCreate && onCreate && (
                <button
                    type="button"
                    onClick={() => onCreate(createName)}
                    className="flex items-center justify-between gap-2 rounded-xl bg-brand-primary/5 px-4 py-3 ring-1 ring-brand ring-inset transition duration-100 ease-linear hover:bg-brand-primary/10"
                >
                    <span className="flex items-center gap-2 text-sm font-medium text-brand-secondary">
                        <FeaturedIcon icon={Plus} color="brand" theme="light" size="sm" />
                        Create &ldquo;{createName}&rdquo;
                    </span>
                    <Plus className="size-4 text-brand-secondary" aria-hidden="true" />
                </button>
            )}

            <div className={cx("grid grid-cols-1 gap-3", DENSITY_COLS[density])}>{filtered.map(card)}</div>
            {filtered.length === 0 && !showCreate && (
                <EmptyState
                    icon={SearchRefraction}
                    color="gray"
                    theme="modern"
                    title="No exercises match your filters"
                    description="Try a different search term, or clear a filter to widen your results."
                />
            )}
        </div>
    );
}

/** Modal exercise picker with image grid — used in active sessions and templates. */
export function ExercisePickerModal({
    exercises,
    lastDone = {},
    existingIds = [],
    onClose,
    onPick,
    onCreate,
}: {
    exercises: ExerciseLibraryItem[];
    lastDone?: Record<string, { date: string; topSet: string | null }>;
    existingIds?: string[];
    onClose: () => void;
    onPick: (id: string) => void;
    onCreate?: (name: string) => void;
}) {
    return (
        <ModalOverlay isOpen onOpenChange={(v) => !v && onClose()}>
            <Modal className="max-w-4xl">
                <Dialog aria-label="Add exercise">
                    <div className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                        <div className="flex items-center justify-between gap-2 border-b border-secondary px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-primary">Add exercise</h2>
                                <p className="text-xs text-tertiary">Search the library — tap a card to add it to your workout.</p>
                            </div>
                            <ButtonUtility size="sm" color="tertiary" icon={X} tooltip="Close" onClick={onClose} />
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <ExerciseLibraryGrid
                                exercises={exercises}
                                density={3}
                                showFilters
                                existingIds={existingIds}
                                lastDone={lastDone}
                                onSelect={onPick}
                                onCreate={onCreate}
                            />
                        </div>
                        <div className="flex justify-end border-t border-secondary px-5 py-3">
                            <Button color="secondary" onClick={onClose}>
                                Done
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
