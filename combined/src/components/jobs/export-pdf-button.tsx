"use client";

import { useState } from "react";
import { FileDownload03 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { getCareerPdfData } from "@/lib/actions/jobs-export";
import { exportCareerPdf } from "@/lib/jobs/pdf";

/**
 * Exports the user's entire career pipeline (applications + companies, with
 * status + health) to a single PDF. Fetches the full dataset on click, so the
 * report is always complete regardless of the current page's filters.
 */
export function ExportPdfButton({ label = "Export PDF", color = "secondary" }: { label?: string; color?: "secondary" | "tertiary" }) {
    const [busy, setBusy] = useState(false);

    async function onExport() {
        setBusy(true);
        try {
            const data = await getCareerPdfData();
            if (data.applications.length === 0 && data.companies.length === 0) {
                toast.error("Nothing to export yet — add a company or application first.");
                return;
            }
            await exportCareerPdf(data);
            toast.success("PDF exported");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't generate the PDF.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Button color={color} iconLeading={FileDownload03} onClick={onExport} isLoading={busy}>
            {label}
        </Button>
    );
}
