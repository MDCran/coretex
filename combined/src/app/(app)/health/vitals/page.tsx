import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { VitalsClient, type VitalRow } from "./vitals-client";

export default async function VitalsPage() {
    const user = await requireUser();
    const vitals = await db.vitalReading.findMany({
        where: { userId: user.id },
        orderBy: { measuredAt: "desc" },
        take: 500,
        include: { fields: { orderBy: { position: "asc" } } },
    });

    const rows: VitalRow[] = vitals.map((v) => ({
        id: v.id,
        vitalType: v.vitalType,
        customName: v.customName,
        value: v.value,
        value2: v.value2,
        unit: v.unit,
        measuredAt: v.measuredAt.toISOString(),
        notes: v.notes,
        fields: v.fields.map((f) => ({ label: f.label, unit: f.unit, value: f.value })),
    }));

    return <VitalsClient vitals={rows} />;
}
