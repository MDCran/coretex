/**
 * Accent (brand) presets. The whole design system derives from --color-brand-{25..950},
 * so overriding just those stops on :root recolors every brand token in both light and
 * dark mode. `scale: null` = the app default (clears the overrides, reverting to theme.css).
 */

export const BRAND_STOPS = [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

export type AccentId = "default" | "violet" | "blue" | "emerald" | "amber" | "rose";

export interface AccentPreset {
    id: AccentId;
    label: string;
    /** Swatch shown in the picker (the 600 stop). */
    swatch: string;
    /** rgb triples per stop, or null to use the built-in default. */
    scale: Record<(typeof BRAND_STOPS)[number], string> | null;
}

const scale = (vals: string[]): Record<(typeof BRAND_STOPS)[number], string> =>
    Object.fromEntries(BRAND_STOPS.map((s, i) => [s, vals[i]])) as Record<(typeof BRAND_STOPS)[number], string>;

export const ACCENTS: AccentPreset[] = [
    { id: "default", label: "Signal", swatch: "rgb(239 66 66)", scale: null },
    {
        id: "violet",
        label: "Violet",
        swatch: "rgb(124 58 237)",
        scale: scale([
            "245 243 255", "245 243 255", "237 233 254", "221 214 254", "196 181 253", "167 139 250",
            "139 92 246", "124 58 237", "109 40 217", "91 33 182", "76 29 149", "46 16 101",
        ]),
    },
    {
        id: "blue",
        label: "Blue",
        swatch: "rgb(37 99 235)",
        scale: scale([
            "239 246 255", "239 246 255", "219 234 254", "191 219 254", "147 197 253", "96 165 250",
            "59 130 246", "37 99 235", "29 78 216", "30 64 175", "30 58 138", "23 37 84",
        ]),
    },
    {
        id: "emerald",
        label: "Emerald",
        swatch: "rgb(5 150 105)",
        scale: scale([
            "236 253 245", "236 253 245", "209 250 229", "167 243 208", "110 231 183", "52 211 153",
            "16 185 129", "5 150 105", "4 120 87", "6 95 70", "6 78 59", "2 44 34",
        ]),
    },
    {
        id: "amber",
        label: "Amber",
        swatch: "rgb(217 119 6)",
        scale: scale([
            "255 251 235", "255 251 235", "254 243 199", "253 230 138", "252 211 77", "251 191 36",
            "245 158 11", "217 119 6", "180 83 9", "146 64 14", "120 53 15", "69 26 3",
        ]),
    },
    {
        id: "rose",
        label: "Rose",
        swatch: "rgb(225 29 72)",
        scale: scale([
            "255 241 242", "255 241 242", "255 228 230", "254 205 211", "253 164 175", "251 113 133",
            "244 63 94", "225 29 72", "190 18 60", "159 18 57", "136 19 55", "76 5 25",
        ]),
    },
];

export const ACCENT_IDS = ACCENTS.map((a) => a.id);

export type Density = "comfortable" | "compact" | "spacious";
export const DENSITIES: { id: Density; label: string; rootFontPx: number }[] = [
    { id: "compact", label: "Compact", rootFontPx: 15 },
    { id: "comfortable", label: "Comfortable", rootFontPx: 16 },
    { id: "spacious", label: "Spacious", rootFontPx: 17 },
];

export const ACCENT_STORAGE_KEY = "lifeos.ui.accent";
export const DENSITY_STORAGE_KEY = "lifeos.ui.density";

/** Modules whose accent can be customized independently of the global accent. */
export const ACCENT_MODULES: { id: string; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "career", label: "Career" },
    { id: "health", label: "Health" },
    { id: "nutrition", label: "Nutrition" },
    { id: "workouts", label: "Workouts" },
    { id: "financial", label: "Financial" },
    { id: "social", label: "Social" },
    { id: "learning", label: "Learning" },
    { id: "calendar", label: "Calendar" },
    { id: "focus", label: "Focus" },
];

/** Per-module accent localStorage key. Value is an AccentId, or "inherit" / unset to use the global accent. */
export const moduleAccentKey = (moduleId: string) => `lifeos.module-accent.${moduleId}`;

/** Resolve the CSS variables for an accent id (null = clear overrides → app default). */
export function accentVars(id: string): Record<string, string> | null {
    const preset = ACCENTS.find((a) => a.id === id);
    if (!preset || !preset.scale) return null;
    const vars: Record<string, string> = {};
    for (const stop of BRAND_STOPS) vars[`--color-brand-${stop}`] = `rgb(${preset.scale[stop]})`;
    return vars;
}
