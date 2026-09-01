// @ts-nocheck
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Heart, Shield01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";

type Action = (formData: FormData) => Promise<void>;

/** One editable 0–10 score slider that saves on release. */
function ScoreSlider({
    contactId,
    field,
    label,
    icon: Icon,
    value,
    accent,
    saveAction,
}: {
    contactId: string;
    field: "closenessScore" | "trustScore";
    label: string;
    icon: typeof Heart;
    value: number | null;
    accent: string;
    saveAction: Action;
}) {
    const [val, setVal] = useState<number>(value ?? 0);
    const [pending, startTransition] = useTransition();

    function save(next: number) {
        const fd = new FormData();
        fd.set("id", contactId);
        fd.set(field, String(next));
        startTransition(async () => {
            try {
                await saveAction(fd);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to save");
            }
        });
    }

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-secondary">
                    <Icon className="size-3.5" aria-hidden="true" /> {label}
                </span>
                <span className={cx("tabular-nums text-tertiary", pending && "opacity-50")}>{val}/10</span>
            </div>
            <input
                type="range"
                min={0}
                max={10}
                value={val}
                onChange={(e) => setVal(Number(e.target.value))}
                onMouseUp={() => save(val)}
                onTouchEnd={() => save(val)}
                onKeyUp={() => save(val)}
                aria-label={`${label} score`}
                className={cx("w-full", accent)}
            />
        </div>
    );
}

/** Closeness + trust sliders that persist immediately to the contact. */
export function ScoreSliders({
    contactId,
    closeness,
    trust,
    saveAction,
}: {
    contactId: string;
    closeness: number | null;
    trust: number | null;
    saveAction: Action;
}) {
    return (
        <div className="flex flex-col gap-4">
            <ScoreSlider contactId={contactId} field="closenessScore" label="Closeness" icon={Heart} value={closeness} accent="accent-brand-solid" saveAction={saveAction} />
            <ScoreSlider contactId={contactId} field="trustScore" label="Trust" icon={Shield01} value={trust} accent="accent-success-solid" saveAction={saveAction} />
        </div>
    );
}
