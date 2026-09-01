"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Star01, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { cx } from "@/utils/cx";
import { PRIORITY_LABELS } from "@/lib/jobs/enums";
import { addPrepItem, deletePrepItem, seedPrepChecklist, setApplicationPriority, togglePrepItem } from "@/lib/actions/career-advanced";

/** Three-tier star priority (Backup → Interested → Dream). Click a star to set; click the current top star to clear. */
export function PriorityStars({ id, value }: { id: string; value: number }) {
    const [pending, start] = useTransition();
    const [optimistic, setOptimistic] = useState(value);

    function set(next: number) {
        const v = optimistic === next ? 0 : next;
        setOptimistic(v);
        start(async () => {
            try {
                const fd = new FormData();
                fd.set("id", id);
                fd.set("priority", String(v));
                await setApplicationPriority(fd);
            } catch (e) {
                setOptimistic(value);
                toast.error(e instanceof Error ? e.message : "Couldn't update priority.");
            }
        });
    }

    return (
        <div className={cx("flex items-center gap-2", pending && "opacity-70")}>
            <div className="flex items-center gap-0.5">
                {[1, 2, 3].map((n) => (
                    <button key={n} type="button" onClick={() => set(n)} aria-label={`Priority ${PRIORITY_LABELS[n]}`} className="p-0.5">
                        <Star01 className={cx("size-5 transition", n <= optimistic ? "fill-current text-yellow-400" : "text-fg-quaternary hover:text-fg-tertiary")} />
                    </button>
                ))}
            </div>
            <span className="text-xs text-tertiary">{PRIORITY_LABELS[optimistic]}</span>
        </div>
    );
}

interface PrepItem {
    id: string;
    label: string;
    done: boolean;
}

/** Per-application interview-prep checklist with add / toggle / delete + seed defaults. */
export function PrepChecklist({ applicationId, items }: { applicationId: string; items: PrepItem[] }) {
    const [pending, start] = useTransition();
    const [label, setLabel] = useState("");

    const run = (fn: () => Promise<void>) =>
        start(async () => {
            try {
                await fn();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Something went wrong.");
            }
        });

    const done = items.filter((i) => i.done).length;

    return (
        <div className="flex flex-col gap-3">
            {items.length === 0 ? (
                <div className="flex flex-col items-start gap-2">
                    <p className="text-sm text-tertiary">No checklist yet.</p>
                    <Button
                        color="secondary"
                        size="sm"
                        isDisabled={pending}
                        onClick={() =>
                            run(async () => {
                                const fd = new FormData();
                                fd.set("applicationId", applicationId);
                                await seedPrepChecklist(fd);
                            })
                        }
                    >
                        Add default checklist
                    </Button>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between text-xs text-tertiary">
                        <span>
                            {done} / {items.length} done
                        </span>
                    </div>
                    <ul className="flex flex-col gap-1">
                        {items.map((it) => (
                            <li key={it.id} className="group flex items-center gap-2">
                                <Checkbox
                                    isSelected={it.done}
                                    isDisabled={pending}
                                    aria-label={it.label}
                                    onChange={() =>
                                        run(async () => {
                                            const fd = new FormData();
                                            fd.set("id", it.id);
                                            await togglePrepItem(fd);
                                        })
                                    }
                                />
                                <span className={cx("flex-1 text-sm", it.done ? "text-tertiary line-through" : "text-secondary")}>{it.label}</span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        run(async () => {
                                            const fd = new FormData();
                                            fd.set("id", it.id);
                                            await deletePrepItem(fd);
                                        })
                                    }
                                    className="text-fg-quaternary opacity-0 transition group-hover:opacity-100 hover:text-fg-error-secondary"
                                    aria-label="Delete item"
                                >
                                    <Trash01 className="size-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            <form
                action={(fd) =>
                    run(async () => {
                        if (!String(fd.get("label") ?? "").trim()) return;
                        await addPrepItem(applicationId, fd);
                        setLabel("");
                    })
                }
                className="flex items-center gap-2"
            >
                <input
                    name="label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Add a prep task…"
                    className="w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary ring-inset outline-hidden placeholder:text-placeholder focus:ring-2 focus:ring-brand"
                />
                <Button type="submit" color="secondary" size="sm" iconLeading={Plus} isDisabled={pending || !label.trim()} aria-label="Add task" />
            </form>
        </div>
    );
}
