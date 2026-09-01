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

const MARGIN = 40;
const ACCENT: [number, number, number] = [127, 86, 217]; // brand-600

export interface CareerPdfApplication {
    company: string;
    role: string;
    status: string;
    workType: string;
    location: string;
    dateApplied: string;
    deadline: string;
    salary: string;
    priority: string;
    health: string;
}

export interface CareerPdfCompany {
    name: string;
    industry: string;
    hqLocation: string;
    website: string;
    applications: number;
    active: number;
    contacts: number;
}

/** Fully serialized, display-ready payload for the career export (built server-side). */
export interface CareerPdfData {
    generatedOn: string;
    counts: { applications: number; companies: number; active: number; offers: number; rejected: number };
    statusCounts: { label: string; count: number }[];
    applications: CareerPdfApplication[];
    companies: CareerPdfCompany[];
}

function finalY(doc: jsPDF): number {
    // jspdf-autotable records the last table's end position here.
    return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function heading(doc: jsPDF, text: string, y: number): number {
    const ph = doc.internal.pageSize.getHeight();
    if (y + 40 > ph - MARGIN) {
        doc.addPage();
        y = MARGIN;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ACCENT);
    doc.text(text, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    return y + 8;
}

function header(doc: jsPDF, data: CareerPdfData): number {
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ACCENT);
    doc.text("Career Tracker — Applications & Companies", MARGIN, MARGIN);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Generated ${data.generatedOn}`, MARGIN, MARGIN + 16);
    const c = data.counts;
    doc.text(
        `${c.applications} applications  ·  ${c.companies} companies  ·  ${c.active} active  ·  ${c.offers} offer(s)  ·  ${c.rejected} rejected`,
        MARGIN,
        MARGIN + 30,
    );
    doc.setTextColor(0);
    return MARGIN + 50;
}

function pageNumbers(doc: jsPDF): void {
    const n = doc.getNumberOfPages();
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Page ${i} of ${n}`, pw - MARGIN, ph - 18, { align: "right" });
    }
    doc.setTextColor(0);
}

/**
 * Download a single combined PDF of the user's whole career pipeline: a status
 * breakdown, the full applications table (with status + health), and the
 * companies table. Runs entirely client-side via lazily-loaded jsPDF.
 */
export async function exportCareerPdf(data: CareerPdfData): Promise<void> {
    await ensurePdfLibs();
    const doc = new jsPDFCtor({ orientation: "landscape", unit: "pt", format: "a4" });
    let y = header(doc, data);

    if (data.statusCounts.length) {
        y = heading(doc, "Status breakdown", y);
        autoTable(doc, {
            startY: y,
            theme: "striped",
            headStyles: { fillColor: ACCENT },
            styles: { fontSize: 9, cellPadding: 4 },
            columnStyles: { 1: { halign: "right", cellWidth: 80 } },
            margin: { left: MARGIN, right: MARGIN },
            tableWidth: 320,
            head: [["Status", "Count"]],
            body: data.statusCounts.map((s) => [s.label, String(s.count)]),
        });
        y = finalY(doc) + 20;
    }

    y = heading(doc, `Applications (${data.applications.length})`, y);
    autoTable(doc, {
        startY: y,
        theme: "striped",
        headStyles: { fillColor: ACCENT },
        styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
        margin: { left: MARGIN, right: MARGIN },
        head: [["Company", "Role", "Status", "Type", "Location", "Applied", "Deadline", "Salary", "Priority", "Health"]],
        body: data.applications.length
            ? data.applications.map((a) => [a.company, a.role, a.status, a.workType, a.location, a.dateApplied, a.deadline, a.salary, a.priority, a.health])
            : [["No applications logged yet", "", "", "", "", "", "", "", "", ""]],
    });
    y = finalY(doc) + 20;

    y = heading(doc, `Companies (${data.companies.length})`, y);
    autoTable(doc, {
        startY: y,
        theme: "striped",
        headStyles: { fillColor: ACCENT },
        styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
        columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
        margin: { left: MARGIN, right: MARGIN },
        head: [["Company", "Industry", "HQ", "Website", "Apps", "Active", "Contacts"]],
        body: data.companies.length
            ? data.companies.map((c) => [c.name, c.industry, c.hqLocation, c.website, String(c.applications), String(c.active), String(c.contacts)])
            : [["No companies saved yet", "", "", "", "", "", ""]],
    });

    pageNumbers(doc);
    doc.save(`career-tracker-${new Date().toISOString().slice(0, 10)}.pdf`);
}
