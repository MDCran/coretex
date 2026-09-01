// @ts-nocheck
import { useEffect, useState } from "react";
import { Check, Monitor01, Moon01, Sun } from "@untitledui/icons";
import { useTheme } from "@teispace/next-themes";
import { SettingsCard, SettingsHeading } from "@/components/settings/settings-ui";
import { useThemeConfig } from "@/components/app-shell/theme/theme-config";
import { ACCENTS, DENSITIES } from "@/components/app-shell/theme/brand-presets";
import { ModuleAccentSettings } from "@/components/settings/module-accent-settings";
import { cx } from "@/utils/cx";

const THEMES = [
    { id: "light", label: "Light", icon: Sun, desc: "Bright and clean", swatch: "bg-white", dot: "bg-gray-300" },
    { id: "dark", label: "Dark", icon: Moon01, desc: "Easy on the eyes", swatch: "bg-gray-900", dot: "bg-gray-600" },
    { id: "system", label: "System", icon: Monitor01, desc: "Match your OS", swatch: "bg-gradient-to-br from-white to-gray-900", dot: "bg-gray-500" },
] as const;

export function AppearanceClient() {
    const { theme, setTheme, resolvedTheme } = useTheme();
    const { accent, density, setAccent, setDensity } = useThemeConfig();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const current = mounted ? theme ?? "system" : null;

    return (
        <div className="flex flex-col gap-6">
            <SettingsCard bloom="brand">
                <SettingsHeading title="Color theme" description="Choose how LifeOS looks on this device. System follows your OS preference." />

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {THEMES.map(({ id, label, icon: Icon, desc, swatch, dot }) => {
                        const selected = current === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => setTheme(id)}
                                className={cx(
                                    "group relative flex flex-col gap-3 overflow-hidden rounded-xl p-4 text-left ring-1 ring-inset outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-offset-2",
                                    selected ? "bg-brand-primary/40 ring-2 ring-brand" : "bg-secondary_subtle ring-secondary hover:bg-secondary_hover",
                                )}
                            >
                                {/* Mini window preview */}
                                <div className={cx("flex h-16 w-full items-end gap-1.5 rounded-lg p-2 ring-1 ring-inset ring-black/10", swatch)}>
                                    <span className={cx("h-2.5 w-8 rounded-full", dot)} />
                                    <span className={cx("h-2.5 w-5 rounded-full opacity-70", dot)} />
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-2">
                                        <Icon className={cx("size-4", selected ? "text-brand-secondary" : "text-fg-quaternary")} aria-hidden="true" />
                                        <span className={cx("text-sm font-semibold", selected ? "text-brand-secondary" : "text-secondary")}>{label}</span>
                                    </span>
                                    {selected && <Check className="size-4 text-fg-brand-primary" aria-hidden="true" />}
                                </div>
                                <span className="text-xs text-tertiary">{desc}</span>
                            </button>
                        );
                    })}
                </div>

                {mounted && resolvedTheme && (
                    <p className="mt-4 text-xs text-tertiary">
                        Active appearance: <span className="font-medium text-secondary">{resolvedTheme === "dark" ? "Dark" : "Light"}</span>
                    </p>
                )}
            </SettingsCard>

            {/* Accent color */}
            <SettingsCard bloom="violet">
                <SettingsHeading title="Accent color" description="Recolor the entire interface. Applied instantly on this device." />
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {ACCENTS.map((a) => {
                        const selected = mounted && accent === a.id;
                        return (
                            <button
                                key={a.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => setAccent(a.id)}
                                className={cx(
                                    "flex flex-col items-center gap-2 rounded-xl p-3 ring-1 ring-inset outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-offset-2",
                                    selected ? "ring-2 ring-brand" : "ring-secondary hover:bg-secondary_hover",
                                )}
                            >
                                <span className="relative flex size-9 items-center justify-center rounded-full ring-1 ring-black/10 ring-inset" style={{ background: a.swatch }}>
                                    {selected && <Check className="size-4 text-white" aria-hidden="true" />}
                                </span>
                                <span className={cx("text-xs font-medium", selected ? "text-brand-secondary" : "text-tertiary")}>{a.label}</span>
                            </button>
                        );
                    })}
                </div>
            </SettingsCard>

            {/* Density */}
            <SettingsCard bloom="blue">
                <SettingsHeading title="Density" description="Tune spacing and type scale to fit more on screen, or give it room to breathe." />
                <div className="mt-5 inline-flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                    {DENSITIES.map((d) => {
                        const selected = mounted && density === d.id;
                        return (
                            <button
                                key={d.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => setDensity(d.id)}
                                className={cx(
                                    "cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition duration-100 ease-linear outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2",
                                    selected ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary",
                                )}
                            >
                                {d.label}
                            </button>
                        );
                    })}
                </div>
            </SettingsCard>

            <ModuleAccentSettings />
        </div>
    );
}
