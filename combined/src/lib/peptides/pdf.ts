// jspdf is loaded lazily so its node build never gets pulled into the SSR bundle.
type jsPDF = import("jspdf").jsPDF;

let jsPDFCtor: typeof import("jspdf").jsPDF;
let autoTable: typeof import("jspdf-autotable").default;

async function ensurePdfLibs(): Promise<void> {
    if (!jsPDFCtor) {
        const [jspdfMod, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
        jsPDFCtor = jspdfMod.jsPDF;
        autoTable = autoTableMod.default;
    }
}
import type { Peptide } from "./types";
import { concentrationMgPerMl, deriveBlock, deriveCycle, mgToUnit, FREQUENCY_PRESETS } from "./dosing";
import { generateSchedule } from "./schedule";
import { isOccurrenceTaken } from "./admin";
import { weekday, WEEKDAY_LABELS } from "./date";
import { fmt, fmtUnits } from "./format";

const MARGIN = 40;
const ACCENT: [number, number, number] = [38, 38, 38];

function freqLabel(n: number): string {
    return FREQUENCY_PRESETS.find((p) => p.value === n)?.label ?? `${n}x / week`;
}

function safeName(s: string): string {
    return s.replace(/[^a-z0-9-_]+/gi, "_") || "peptide";
}

function finalY(doc: jsPDF): number {
    // jspdf-autotable records the last table's end position here.
    return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function ensureSpace(doc: jsPDF, y: number, needed = 60): number {
    const ph = doc.internal.pageSize.getHeight();
    if (y + needed > ph - MARGIN) {
        doc.addPage();
        return MARGIN;
    }
    return y;
}

function heading(doc: jsPDF, text: string, y: number): number {
    y = ensureSpace(doc, y, 40);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ACCENT);
    doc.text(text.toUpperCase(), MARGIN, y);
    doc.setFont("helvetica", "normal");
    return y + 6;
}

function infoTable(doc: jsPDF, y: number, rows: [string, string][]): number {
    autoTable(doc, {
        startY: y,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 3 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 150 } },
        margin: { left: MARGIN, right: MARGIN },
        body: rows,
    });
    return finalY(doc) + 16;
}

/** Render one peptide's full detail starting at y; returns the next y. */
function peptideSection(doc: jsPDF, p: Peptide, startY: number): number {
    let y = ensureSpace(doc, startY, 80);
    const u = p.doseUnit;
    const conc = concentrationMgPerMl(p.vialMg, p.waterMl);
    const s = deriveCycle(p);

    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ACCENT);
    doc.text(p.name || "Untitled", MARGIN, y);
    doc.setFont("helvetica", "normal");
    y += 16;

    y = heading(doc, "Vial & reconstitution", y);
    y = infoTable(doc, y, [
        ["Vial strength", `${fmt(p.vialMg)} mg`],
        ["Bacteriostatic water", `${fmt(p.waterMl)} ml`],
        ["Concentration", p.waterMl > 0 ? `${fmt(conc)} mg/ml` : "—"],
        ["Dose unit", u],
        ["Syringe", `U-${p.syringeUnitsPerMl} (${p.syringeUnitsPerMl} units = 1 ml)`],
        ["Per syringe unit", p.waterMl > 0 ? `${fmt(mgToUnit(conc / p.syringeUnitsPerMl, u), 4)} ${u}/unit` : "—"],
        ["Vials owned", fmt(p.vialsOwned)],
        ["Vials opened", fmt(p.vialsOpened)],
        ["Active vial remaining", `${fmt(p.activeVialRemainingMl, 3)} ml`],
        ["Cycle start date", p.cycleStartDate || "—"],
    ]);

    y = heading(doc, "Cycle summary", y);
    y = infoTable(doc, y, [
        ["Cycle total", `${fmt(mgToUnit(s.cycleTotalMg, u), 2)} ${u}`],
        ["Available", `${fmt(mgToUnit(s.availableMg, u), 2)} ${u}`],
        ["Vials needed", String(s.vialsNeeded)],
        ["Status", s.overBudget ? `SHORT by ${fmt(mgToUnit(s.shortfallMg, u), 2)} ${u}` : "Within supply"],
    ]);

    y = heading(doc, "Cycle plan", y);
    if (p.blocks.length === 0) {
        doc.setFontSize(8);
        doc.text("No blocks.", MARGIN, y + 4);
        y += 18;
    } else {
        autoTable(doc, {
            startY: y,
            theme: "striped",
            headStyles: { fillColor: ACCENT },
            styles: { fontSize: 8, cellPadding: 3 },
            margin: { left: MARGIN, right: MARGIN },
            head: [["Weeks", `Dose (${u})`, "Frequency", "Units/dose", "Admins", `Total (${u})`, "Note"]],
            body: p.blocks.map((b) => {
                const d = deriveBlock(b, p);
                return [
                    `${b.startWeek}-${b.endWeek}`,
                    fmt(b.dosePerAdmin),
                    freqLabel(b.dosesPerWeek),
                    d.mlPerAdmin > 0 ? fmtUnits(d.unitsPerAdmin) : "—",
                    fmt(d.totalAdmins, 1),
                    fmt(mgToUnit(d.totalDoseMg, u), 2),
                    b.note ?? "",
                ];
            }),
        });
        y = finalY(doc) + 16;
    }

    const occ = generateSchedule(p);
    y = heading(doc, `Schedule — ${occ.length} dose(s)`, y);
    if (occ.length === 0) {
        doc.setFontSize(8);
        doc.text("No scheduled doses (set a cycle start date and blocks).", MARGIN, y + 4);
        y += 18;
    } else {
        autoTable(doc, {
            startY: y,
            theme: "striped",
            headStyles: { fillColor: ACCENT },
            styles: { fontSize: 8, cellPadding: 3 },
            margin: { left: MARGIN, right: MARGIN },
            head: [["Date", "Day", "Wk", `Dose (${u})`, "Units", "Note", "Taken"]],
            body: occ.map((o) => [
                o.date,
                WEEKDAY_LABELS[weekday(o.date)],
                String(o.weekNumber),
                fmt(o.dose),
                fmtUnits(o.units),
                o.note ?? "",
                isOccurrenceTaken(p, o) ? "Yes" : "",
            ]),
        });
        y = finalY(doc) + 16;
    }

    const logs = [...p.logs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    y = heading(doc, `Administration log — ${logs.length} entr${logs.length === 1 ? "y" : "ies"}`, y);
    if (logs.length === 0) {
        doc.setFontSize(8);
        doc.text("No entries logged.", MARGIN, y + 4);
        y += 18;
    } else {
        autoTable(doc, {
            startY: y,
            theme: "striped",
            headStyles: { fillColor: ACCENT },
            styles: { fontSize: 8, cellPadding: 3 },
            margin: { left: MARGIN, right: MARGIN },
            head: [["Date", `Dose (${u})`, "Units", "ml used", "Site"]],
            body: logs.map((l) => [l.date, fmt(l.dose), fmtUnits(l.units), fmt(l.mlUsed, 4), l.site]),
        });
        y = finalY(doc) + 16;
    }

    return y;
}

function header(doc: jsPDF, title: string): number {
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ACCENT);
    doc.text(title, MARGIN, MARGIN);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Generated ${new Date().toLocaleString()}`, MARGIN, MARGIN + 14);
    doc.setTextColor(0);
    return MARGIN + 34;
}

function pageNumbers(doc: jsPDF): void {
    const n = doc.getNumberOfPages();
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Page ${i} of ${n}`, pw - MARGIN, ph - 20, { align: "right" });
    }
    doc.setTextColor(0);
}

/** Download a full-detail PDF for a single peptide. */
export async function exportPeptidePdf(peptide: Peptide): Promise<void> {
    await ensurePdfLibs();
    const doc = new jsPDFCtor({ unit: "pt", format: "a4" });
    const y = header(doc, "Peptide Tracker");
    peptideSection(doc, peptide, y);
    pageNumbers(doc);
    doc.save(`${safeName(peptide.name)}_report.pdf`);
}

/** Download a combined PDF: overview table + every peptide's full detail. */
export async function exportOverviewPdf(peptides: Peptide[]): Promise<void> {
    await ensurePdfLibs();
    const doc = new jsPDFCtor({ unit: "pt", format: "a4" });
    let y = header(doc, "Peptide Tracker — Overview");

    y = heading(doc, "All peptides", y);
    autoTable(doc, {
        startY: y,
        theme: "striped",
        headStyles: { fillColor: ACCENT },
        styles: { fontSize: 8, cellPadding: 3 },
        margin: { left: MARGIN, right: MARGIN },
        head: [["Peptide", "Dose", "Units/dose", "Cycle total", "Vials needed", "Bac. water", "Status"]],
        body: peptides.map((p) => {
            const s = deriveCycle(p);
            const u = p.doseUnit;
            const doses = [...new Set(p.blocks.filter((b) => b.dosePerAdmin > 0).map((b) => `${fmt(b.dosePerAdmin)} ${u}`))];
            const units = [
                ...new Set(
                    p.blocks
                        .map((b) => deriveBlock(b, p).unitsPerAdmin)
                        .filter((x) => x > 0)
                        .map((x) => `${fmtUnits(x)}u`),
                ),
            ];
            return [
                p.name,
                doses.join(", ") || "—",
                units.join(", ") || "—",
                `${fmt(mgToUnit(s.cycleTotalMg, u), 2)} ${u}`,
                String(s.vialsNeeded),
                `${fmt(p.waterMl)} ml`,
                s.overBudget ? `Short ${fmt(mgToUnit(s.shortfallMg, u), 1)} ${u}` : "OK",
            ];
        }),
    });

    for (const p of peptides) {
        doc.addPage();
        peptideSection(doc, p, MARGIN);
    }

    pageNumbers(doc);
    doc.save("peptide_tracker_overview.pdf");
}
