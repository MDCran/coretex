import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listPeptides } from "@/lib/actions/peptides";
import { PeptidesOverviewClient } from "@/components/application/peptides/overview-client";

export default async function PeptidesPage() {
    const user = await requireUser();
    const [peptides, settings] = await Promise.all([
        listPeptides(),
        db.settings.findUnique({ where: { userId: user.id }, select: { unitSystem: true } }),
    ]);
    const unitSystem = settings?.unitSystem ?? "IMPERIAL";
    return <PeptidesOverviewClient initial={peptides} unitSystem={unitSystem} />;
}
