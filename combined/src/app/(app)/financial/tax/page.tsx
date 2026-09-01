import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { TaxClient, type TaxRow } from "./tax-client";

export default async function TaxPage() {
    const user = await requireUser();
    const docs = await db.taxDocument.findMany({ where: { userId: user.id }, orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }] });

    const rows: TaxRow[] = docs.map((d) => ({
        id: d.id,
        taxYear: d.taxYear,
        kind: d.kind,
        description: d.description,
        fileName: d.fileName,
        downloadUrl: d.fileKey ? fileUrl(d.fileKey, { name: d.fileName ?? undefined }) : null,
        notes: d.notes,
    }));

    return <TaxClient docs={rows} />;
}
