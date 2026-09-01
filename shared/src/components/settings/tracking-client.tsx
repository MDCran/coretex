// @ts-nocheck
import type { FC } from "react";
import { useState, useTransition } from "react";
const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });
import {
    Activity,
    ActivityHeart,
    BankNote03,
    BookOpen01,
    Briefcase01,
    Calendar,
    CheckDone01,
    Eye,
    MusicNote01,
    Scales01,
    Target04,
    Users01,
} from "@untitledui/icons";
import { toast } from "sonner";
import { SettingsCard } from "@/components/settings/settings-ui";
import { Toggle } from "@/components/base/toggle/toggle";
import { TRACKABLE_AREAS, type AreaKey } from "@/lib/areas";
import { updateTrackedAreas } from "@/lib/actions/settings";
import { cx } from "@/utils/cx";

const AREA_ICON: Record<AreaKey, FC<{ className?: string }>> = {
    career: Briefcase01,
    health: ActivityHeart,
    nutrition: Scales01,
    workouts: Activity,
    music: MusicNote01,
    financial: BankNote03,
    social: Users01,
    learning: BookOpen01,
    calendar: Calendar,
    focus: Target04,
    todos: CheckDone01,
};

const AREA_CHIP: Record<AreaKey, string> = {
    career: "bg-utility-blue-50 text-utility-blue-700 ring-utility-blue-100",
    health: "bg-utility-green-50 text-utility-green-700 ring-utility-green-100",
    nutrition: "bg-utility-green-50 text-utility-green-700 ring-utility-green-100",
    workouts: "bg-utility-orange-50 text-utility-orange-700 ring-utility-orange-100",
    music: "bg-utility-pink-50 text-utility-pink-700 ring-utility-pink-100",
    financial: "bg-utility-indigo-50 text-utility-indigo-700 ring-utility-indigo-100",
    social: "bg-utility-pink-50 text-utility-pink-700 ring-utility-pink-100",
    learning: "bg-utility-yellow-50 text-utility-yellow-700 ring-utility-yellow-100",
    calendar: "bg-utility-purple-50 text-utility-purple-700 ring-utility-purple-100",
    focus: "bg-utility-fuchsia-50 text-utility-fuchsia-700 ring-utility-fuchsia-100",
    todos: "bg-utility-blue-50 text-utility-blue-700 ring-utility-blue-100",
};

export function TrackingClient({ initialHidden }: { initialHidden: AreaKey[] }) {
    const router = useRouter();
    const [hidden, setHidden] = useState<AreaKey[]>(initialHidden);
    const [pending, startTransition] = useTransition();

    const enabledCount = TRACKABLE_AREAS.length - hidden.length;

    function setAreas(next: AreaKey[], message: string) {
        const prev = hidden;
        setHidden(next);
        startTransition(async () => {
            try {
                await updateTrackedAreas(next);
                toast.success(message);
                router.refresh();
            } catch (e) {
                setHidden(prev); // revert on failure
                toast.error(e instanceof Error ? e.message : "Couldn't save");
            }
        });
    }

    function toggle(key: AreaKey, enabled: boolean, label: string) {
        const next = enabled ? hidden.filter((k) => k !== key) : [...hidden, key];
        setAreas(next, enabled ? `${label} is now tracked` : `${label} hidden from your sidebar`);
    }

    return (
        <div className="flex flex-col gap-6">
            <SettingsCard bloom="emerald">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-semibold text-primary">Areas of life</h2>
                        <p className="mt-0.5 text-sm text-tertiary">
                            Turn an area on to track and manage it, or off to hide it from your sidebar and dashboard. You can change this any
                            time — nothing is deleted.
                        </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-secondary px-2.5 py-1 text-xs font-medium text-success-primary ring-1 ring-utility-green-300 ring-inset">
                        <Eye className="size-3.5 text-fg-success-primary" aria-hidden="true" />
                        {enabledCount} of {TRACKABLE_AREAS.length} tracked
                    </span>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={pending || hidden.length === 0}
                        onClick={() => setAreas([], "All areas are now tracked")}
                        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-secondary ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover disabled:opacity-50"
                    >
                        Enable all
                    </button>
                    <button
                        type="button"
                        disabled={pending || hidden.length === TRACKABLE_AREAS.length}
                        onClick={() => setAreas(TRACKABLE_AREAS.map((a) => a.key), "Tracking only the core areas")}
                        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-secondary ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover disabled:opacity-50"
                    >
                        Disable all
                    </button>
                </div>

                <ul className="mt-4 flex flex-col divide-y divide-secondary">
                    {TRACKABLE_AREAS.map((area) => {
                        const Icon = AREA_ICON[area.key];
                        const enabled = !hidden.includes(area.key);
                        return (
                            <li key={area.key} className="flex items-center gap-3.5 py-3.5 first:pt-0 last:pb-0">
                                <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", AREA_CHIP[area.key])}>
                                    <Icon className="size-5" aria-hidden="true" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className={cx("text-sm font-semibold", enabled ? "text-primary" : "text-tertiary")}>{area.label}</p>
                                    <p className="truncate text-xs text-tertiary">{area.description}</p>
                                </div>
                                <Toggle
                                    aria-label={`Track ${area.label}`}
                                    isSelected={enabled}
                                    isDisabled={pending}
                                    onChange={(v) => toggle(area.key, v, area.label)}
                                    size="md"
                                />
                            </li>
                        );
                    })}
                </ul>
            </SettingsCard>
        </div>
    );
}
