"use client";

import { useState } from "react";
import { FileDownload03 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";

export interface ReportCardData {
    generatedOn: string;
    cumulativeGpa: number | null;
    totalCredits: number;
    classes: { name: string; term: string | null; credits: number | null; percent: number | null; letter: string | null }[];
    studyHoursMonth: number;
    studyHoursAllTime: number;
    coursesCompleted: number;
    goalsAchieved: number;
    achievements: string[];
}

/** Generates an end-of-semester report-card PDF entirely client-side via jsPDF. */
export function ReportCardButton({ data }: { data: ReportCardData }) {
    const [busy, setBusy] = useState(false);

    async function exportPdf() {
        setBusy(true);
        try {
            const { jsPDF } = await import("jspdf");
            const autoTable = (await import("jspdf-autotable")).default;
            const doc = new jsPDF();

            doc.setFontSize(18);
            doc.text("Learning Report Card", 14, 20);
            doc.setFontSize(10);
            doc.setTextColor(110);
            doc.text(`Generated ${data.generatedOn}`, 14, 27);

            doc.setFontSize(13);
            doc.setTextColor(20);
            doc.text(`Cumulative GPA: ${data.cumulativeGpa != null ? data.cumulativeGpa.toFixed(2) : "—"}  ·  ${data.totalCredits} credits`, 14, 38);

            autoTable(doc, {
                startY: 44,
                head: [["Class", "Term", "Credits", "Grade", "Letter"]],
                body: data.classes.length
                    ? data.classes.map((c) => [c.name, c.term ?? "—", c.credits != null ? String(c.credits) : "—", c.percent != null ? `${c.percent.toFixed(1)}%` : "—", c.letter ?? "—"])
                    : [["No classes", "", "", "", ""]],
                styles: { fontSize: 9 },
                headStyles: { fillColor: [127, 86, 217] },
            });

            // @ts-expect-error lastAutoTable is added by jspdf-autotable at runtime
            const afterTable: number = doc.lastAutoTable?.finalY ?? 90;

            doc.setFontSize(12);
            doc.setTextColor(20);
            doc.text("Summary", 14, afterTable + 12);
            doc.setFontSize(10);
            doc.setTextColor(80);
            const lines = [
                `Study time this month: ${data.studyHoursMonth}h`,
                `Study time all-time: ${data.studyHoursAllTime}h`,
                `Courses completed: ${data.coursesCompleted}`,
                `Goals achieved: ${data.goalsAchieved}`,
                `Achievements earned: ${data.achievements.length}`,
            ];
            lines.forEach((l, i) => doc.text(l, 14, afterTable + 20 + i * 6));

            if (data.achievements.length) {
                const y = afterTable + 20 + lines.length * 6 + 8;
                doc.setFontSize(12);
                doc.setTextColor(20);
                doc.text("Achievements", 14, y);
                doc.setFontSize(10);
                doc.setTextColor(80);
                data.achievements.forEach((a, i) => doc.text(`• ${a}`, 14, y + 8 + i * 6));
            }

            doc.save(`learning-report-card-${data.generatedOn}.pdf`);
            toast.success("Report card exported");
        } catch {
            toast.error("Couldn't generate the report card PDF.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Button size="sm" color="secondary" iconLeading={FileDownload03} onClick={exportPdf} isLoading={busy}>
            Report card PDF
        </Button>
    );
}
