import type { Peptide } from "./types";
import { deriveBlock, mgToUnit, FREQUENCY_PRESETS } from "./dosing";

function freqLabel(n: number): string {
    return FREQUENCY_PRESETS.find((p) => p.value === n)?.label ?? `${n}x / week`;
}

function csvCell(v: string | number): string {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV of the peptide's cycle plan, one row per block. */
export function planToCsv(peptide: Peptide): string {
    const u = peptide.doseUnit;
    const header = [
        "Peptide",
        "Start week",
        "End week",
        "Weeks",
        `Dose (${u})`,
        "Frequency",
        "Doses/week",
        "Units/dose",
        "ml/dose",
        "Admins",
        `Block total (${u})`,
        "Note / timing",
    ];
    const rows = peptide.blocks.map((b) => {
        const d = deriveBlock(b, peptide);
        return [
            peptide.name,
            b.startWeek,
            b.endWeek,
            d.weeks,
            b.dosePerAdmin,
            freqLabel(b.dosesPerWeek),
            b.dosesPerWeek,
            Number(d.unitsPerAdmin.toFixed(2)),
            Number(d.mlPerAdmin.toFixed(4)),
            d.totalAdmins,
            Number(mgToUnit(d.totalDoseMg, u).toFixed(3)),
            b.note ?? "",
        ];
    });
    return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Trigger a client-side download of the plan CSV. */
export function downloadPlanCsv(peptide: Peptide): void {
    const blob = new Blob([planToCsv(peptide)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = peptide.name.replace(/[^a-z0-9-_]+/gi, "_") || "peptide";
    a.href = url;
    a.download = `${safe}_cycle_plan.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
