/**
 * Unit conversion + formatting helpers.
 *
 * The database ALWAYS stores metric values (kg, cm, ml, km). These helpers
 * convert to/from the user's chosen display unit system and format values for
 * display. Use them in any consumer that surfaces a weight / height / volume /
 * distance to respect `Settings.unitSystem`.
 */

export type UnitSystem = "METRIC" | "IMPERIAL";

// ── Constants ───────────────────────────────────────────────────────────────
const LB_PER_KG = 2.2046226218;
const IN_PER_CM = 1 / 2.54;
const OZ_PER_ML = 0.033814022702; // US fluid ounces
const MI_PER_KM = 0.62137119224;

// ── Weight (kg ↔ lb) ──────────────────────────────────────────────────────────
export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;

// ── Length (cm ↔ in) ──────────────────────────────────────────────────────────
export const cmToIn = (cm: number): number => cm * IN_PER_CM;
export const inToCm = (inch: number): number => inch / IN_PER_CM;

/** Convert centimetres to whole feet + inches. */
export function cmToFtIn(cm: number): { ft: number; in: number } {
    const totalIn = cmToIn(cm);
    const ft = Math.floor(totalIn / 12);
    const inch = Math.round((totalIn - ft * 12) * 10) / 10;
    return { ft, in: inch };
}

// ── Volume (ml ↔ oz) ──────────────────────────────────────────────────────────
export const mlToOz = (ml: number): number => ml * OZ_PER_ML;
export const ozToMl = (oz: number): number => oz / OZ_PER_ML;

// ── Distance (km ↔ mi) ────────────────────────────────────────────────────────
export const kmToMi = (km: number): number => km * MI_PER_KM;
export const miToKm = (mi: number): number => mi / MI_PER_KM;

// ── Unit labels ───────────────────────────────────────────────────────────────
export const weightUnit = (system: UnitSystem): string => (system === "IMPERIAL" ? "lb" : "kg");
export const heightUnit = (system: UnitSystem): string => (system === "IMPERIAL" ? "in" : "cm");
export const volumeUnit = (system: UnitSystem): string => (system === "IMPERIAL" ? "oz" : "ml");
export const distanceUnit = (system: UnitSystem): string => (system === "IMPERIAL" ? "mi" : "km");

// ── Rounding helpers ──────────────────────────────────────────────────────────
const round = (n: number, decimals: number): number => {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
};

/** Convert a stored kg value into the display unit, rounded sensibly (1 dp lb). */
export function weightToDisplay(valueKg: number, system: UnitSystem): number {
    return system === "IMPERIAL" ? round(kgToLb(valueKg), 1) : round(valueKg, 1);
}

/** Convert a stored cm value into the display unit, rounded sensibly (1 dp in). */
export function heightToDisplay(valueCm: number, system: UnitSystem): number {
    return system === "IMPERIAL" ? round(cmToIn(valueCm), 1) : round(valueCm, 1);
}

/** Convert a stored ml value into the display unit (whole oz). */
export function volumeToDisplay(valueMl: number, system: UnitSystem): number {
    return system === "IMPERIAL" ? Math.round(mlToOz(valueMl)) : Math.round(valueMl);
}

/** Convert a stored km value into the display unit (2 dp). */
export function distanceToDisplay(valueKm: number, system: UnitSystem): number {
    return system === "IMPERIAL" ? round(kmToMi(valueKm), 2) : round(valueKm, 2);
}

// ── Formatters (value + unit string) ──────────────────────────────────────────
export function formatWeight(valueKg: number | null | undefined, system: UnitSystem): string {
    if (valueKg == null || !Number.isFinite(valueKg)) return "—";
    return `${weightToDisplay(valueKg, system)} ${weightUnit(system)}`;
}

export function formatHeight(valueCm: number | null | undefined, system: UnitSystem): string {
    if (valueCm == null || !Number.isFinite(valueCm)) return "—";
    if (system === "IMPERIAL") {
        const { ft, in: inch } = cmToFtIn(valueCm);
        return `${ft}' ${inch}"`;
    }
    return `${round(valueCm, 1)} cm`;
}

export function formatVolume(valueMl: number | null | undefined, system: UnitSystem): string {
    if (valueMl == null || !Number.isFinite(valueMl)) return "—";
    return `${volumeToDisplay(valueMl, system)} ${volumeUnit(system)}`;
}

export function formatDistance(valueKm: number | null | undefined, system: UnitSystem): string {
    if (valueKm == null || !Number.isFinite(valueKm)) return "—";
    return `${distanceToDisplay(valueKm, system)} ${distanceUnit(system)}`;
}

// ── Input parsers (display unit → metric for storage) ─────────────────────────
/** Parse a user-entered weight (in the display unit) into kg for storage. */
export function parseWeightInput(value: number | string, system: UnitSystem): number | null {
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(n)) return null;
    return system === "IMPERIAL" ? round(lbToKg(n), 4) : n;
}

/** Parse a user-entered height (in the display unit) into cm for storage. */
export function parseHeightInput(value: number | string, system: UnitSystem): number | null {
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(n)) return null;
    return system === "IMPERIAL" ? round(inToCm(n), 4) : n;
}

/** Parse a user-entered volume (in the display unit) into ml for storage. */
export function parseVolumeInput(value: number | string, system: UnitSystem): number | null {
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(n)) return null;
    return system === "IMPERIAL" ? Math.round(ozToMl(n)) : n;
}

/** Parse a user-entered distance (in the display unit) into km for storage. */
export function parseDistanceInput(value: number | string, system: UnitSystem): number | null {
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(n)) return null;
    return system === "IMPERIAL" ? round(miToKm(n), 4) : n;
}

/**
 * Water quick-add presets per unit system. Stored as ml.
 * Metric: +250 ml / +500 ml. Imperial: +8 oz / +16 oz (rounded to ml).
 */
export function waterQuickAdds(system: UnitSystem): { label: string; ml: number }[] {
    if (system === "IMPERIAL") {
        return [
            { label: "+8 oz", ml: Math.round(ozToMl(8)) },
            { label: "+16 oz", ml: Math.round(ozToMl(16)) },
        ];
    }
    return [
        { label: "+250 ml", ml: 250 },
        { label: "+500 ml", ml: 500 },
    ];
}
