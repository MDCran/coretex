/**
 * Unit conversion helpers. Persist metric values and convert only at the UI
 * boundary so changing a profile's display system never changes stored data.
 */

export type UnitSystem = "METRIC" | "IMPERIAL";

const LB_PER_KG = 2.2046226218;
const IN_PER_CM = 1 / 2.54;
const FL_OZ_PER_ML = 0.033814022702;
const MI_PER_KM = 0.62137119224;

const round = (value: number, decimals: number): number => {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
};

export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const cmToIn = (cm: number): number => cm * IN_PER_CM;
export const inToCm = (inch: number): number => inch / IN_PER_CM;
export const mlToOz = (ml: number): number => ml * FL_OZ_PER_ML;
export const ozToMl = (oz: number): number => oz / FL_OZ_PER_ML;
export const kmToMi = (km: number): number => km * MI_PER_KM;
export const miToKm = (mi: number): number => mi / MI_PER_KM;

export function cmToFtIn(cm: number): { ft: number; in: number } {
    const totalInches = cmToIn(cm);
    const ft = Math.floor(totalInches / 12);
    return { ft, in: round(totalInches - ft * 12, 1) };
}

export const weightUnit = (system: UnitSystem): string => system === "IMPERIAL" ? "lb" : "kg";
export const heightUnit = (system: UnitSystem): string => system === "IMPERIAL" ? "in" : "cm";
export const volumeUnit = (system: UnitSystem): string => system === "IMPERIAL" ? "fl oz" : "ml";
export const distanceUnit = (system: UnitSystem): string => system === "IMPERIAL" ? "mi" : "km";

export function weightToDisplay(valueKg: number, system: UnitSystem): number {
    return system === "IMPERIAL" ? round(kgToLb(valueKg), 1) : round(valueKg, 1);
}

export function heightToDisplay(valueCm: number, system: UnitSystem): number {
    return system === "IMPERIAL" ? round(cmToIn(valueCm), 1) : round(valueCm, 1);
}

export function volumeToDisplay(valueMl: number, system: UnitSystem): number {
    return system === "IMPERIAL" ? round(mlToOz(valueMl), 1) : Math.round(valueMl);
}

export function distanceToDisplay(valueKm: number, system: UnitSystem): number {
    return system === "IMPERIAL" ? round(kmToMi(valueKm), 2) : round(valueKm, 2);
}

export function formatWeight(valueKg: number | null | undefined, system: UnitSystem): string {
    return valueKg == null || !Number.isFinite(valueKg) ? "—" : `${weightToDisplay(valueKg, system)} ${weightUnit(system)}`;
}

export function formatHeight(valueCm: number | null | undefined, system: UnitSystem): string {
    if (valueCm == null || !Number.isFinite(valueCm)) return "—";
    if (system === "IMPERIAL") {
        const { ft, in: inches } = cmToFtIn(valueCm);
        return `${ft}' ${inches}\"`;
    }
    return `${round(valueCm, 1)} cm`;
}

export function formatVolume(valueMl: number | null | undefined, system: UnitSystem): string {
    return valueMl == null || !Number.isFinite(valueMl) ? "—" : `${volumeToDisplay(valueMl, system)} ${volumeUnit(system)}`;
}

export function formatDistance(valueKm: number | null | undefined, system: UnitSystem): string {
    return valueKm == null || !Number.isFinite(valueKm) ? "—" : `${distanceToDisplay(valueKm, system)} ${distanceUnit(system)}`;
}

export function parseWeightInput(value: number | string, system: UnitSystem): number | null {
    const numeric = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(numeric)) return null;
    return system === "IMPERIAL" ? round(lbToKg(numeric), 4) : numeric;
}

export function parseHeightInput(value: number | string, system: UnitSystem): number | null {
    const numeric = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(numeric)) return null;
    return system === "IMPERIAL" ? round(inToCm(numeric), 4) : numeric;
}

export function parseVolumeInput(value: number | string, system: UnitSystem): number | null {
    const numeric = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(numeric)) return null;
    return system === "IMPERIAL" ? Math.round(ozToMl(numeric)) : Math.round(numeric);
}

export function parseDistanceInput(value: number | string, system: UnitSystem): number | null {
    const numeric = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(numeric)) return null;
    return system === "IMPERIAL" ? round(miToKm(numeric), 4) : numeric;
}

export function waterQuickAdds(system: UnitSystem): Array<{ label: string; ml: number }> {
    if (system === "IMPERIAL") {
        return [
            { label: "8 fl oz", ml: Math.round(ozToMl(8)) },
            { label: "16 fl oz", ml: Math.round(ozToMl(16)) },
            { label: "24 fl oz", ml: Math.round(ozToMl(24)) },
        ];
    }
    return [
        { label: "250 ml", ml: 250 },
        { label: "500 ml", ml: 500 },
        { label: "750 ml", ml: 750 },
    ];
}
