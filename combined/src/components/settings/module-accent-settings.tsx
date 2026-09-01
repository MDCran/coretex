"use client";

import { useEffect, useState } from "react";
import { SettingsCard, SettingsHeading } from "@/components/settings/settings-ui";
import { ACCENTS, ACCENT_MODULES, moduleAccentKey } from "@/components/app-shell/theme/brand-presets";
import { MODULE_ACCENTS_CHANGED_EVENT } from "@/components/app-shell/theme/module-accent-applier";

const SELECT_CLASS =
    "cursor-pointer appearance-none rounded-lg bg-primary px-3 py-1.5 pr-8 text-sm text-primary ring-1 ring-primary ring-inset transition focus:outline-2 focus:-outline-offset-2 focus:outline-brand";

/** Per-module accent picker. Persists to localStorage; ModuleAccentApplier applies it per route. */
export function ModuleAccentSettings() {
    const [mounted, setMounted] = useState(false);
    const [prefs, setPrefs] = useState<Record<string, string>>({});

    useEffect(() => {
        setMounted(true);
        const next: Record<string, string> = {};
        for (const m of ACCENT_MODULES) {
            try {
                next[m.id] = localStorage.getItem(moduleAccentKey(m.id)) || "inherit";
            } catch {
                next[m.id] = "inherit";
            }
        }
        setPrefs(next);
    }, []);

    function set(moduleId: string, id: string) {
        try {
            if (id === "inherit") localStorage.removeItem(moduleAccentKey(moduleId));
            else localStorage.setItem(moduleAccentKey(moduleId), id);
        } catch {
            /* ignore */
        }
        setPrefs((p) => ({ ...p, [moduleId]: id }));
        // Tell ModuleAccentApplier to re-apply for the current route so the change is live
        // without navigation (it ignores changes to other modules' accents anyway).
        try {
            window.dispatchEvent(new CustomEvent(MODULE_ACCENTS_CHANGED_EVENT, { detail: { moduleId, id } }));
        } catch {
            /* ignore */
        }
    }

    return (
        <SettingsCard bloom="amber">
            <SettingsHeading
                title="Module colors"
                description="Give each section its own accent. It applies when you open that section; otherwise it follows your global accent."
            />
            <ul className="mt-4 flex flex-col divide-y divide-secondary">
                {ACCENT_MODULES.map((m) => {
                    const val = mounted ? prefs[m.id] ?? "inherit" : "inherit";
                    const preset = ACCENTS.find((a) => a.id === val);
                    return (
                        <li key={m.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                            <div className="flex items-center gap-2.5">
                                <span
                                    className="size-4 shrink-0 rounded-full ring-1 ring-black/10 ring-inset"
                                    style={{ background: val === "inherit" ? "var(--color-brand-600)" : preset?.swatch ?? "var(--color-brand-600)" }}
                                    aria-hidden="true"
                                />
                                <span className="text-sm font-medium text-secondary">{m.label}</span>
                            </div>
                            <select aria-label={`${m.label} accent`} value={val} onChange={(e) => set(m.id, e.target.value)} className={SELECT_CLASS}>
                                <option value="inherit">Global accent</option>
                                {ACCENTS.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.label}
                                    </option>
                                ))}
                            </select>
                        </li>
                    );
                })}
            </ul>
        </SettingsCard>
    );
}
