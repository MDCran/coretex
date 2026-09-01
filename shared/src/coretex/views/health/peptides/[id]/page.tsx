// @ts-nocheck



import { PeptideDetailClient } from "@/components/application/peptides/peptide-detail-client";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

export default async function PeptideDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await requireUser();
    const [peptide, all, settings] = await Promise.all([
        getPeptide(id),
        listPeptides(),
        db.settings.findUnique({ where: { userId: user.id }, select: { unitSystem: true } }),
    ]);
    if (!peptide) notFound();

    // Stable color index by position in the user's full peptide list.
    const colorIndex = Math.max(0, all.findIndex((p) => p.id === id));
    const unitSystem = settings?.unitSystem ?? "IMPERIAL";

    return <PeptideDetailClient peptide={peptide} colorIndex={colorIndex} unitSystem={unitSystem} />;
}
