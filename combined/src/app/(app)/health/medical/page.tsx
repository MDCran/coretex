import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { MedicalClient, type DoctorRow, type ProviderRow, type RecordRow } from "./medical-client";

export default async function MedicalPage() {
    const user = await requireUser();
    const [records, providers, doctors] = await Promise.all([
        db.medicalRecord.findMany({
            where: { userId: user.id },
            orderBy: { recordDate: "desc" },
            include: { provider: true, doctor: true, extractedItems: true },
        }),
        db.provider.findMany({ where: { userId: user.id, archived: false }, orderBy: { name: "asc" } }),
        db.doctor.findMany({ where: { userId: user.id, archived: false }, orderBy: { name: "asc" } }),
    ]);

    const recordRows: RecordRow[] = records.map((r) => ({
        id: r.id,
        name: r.name,
        recordDate: r.recordDate?.toISOString() ?? null,
        notes: r.notes,
        fileName: r.fileName,
        fileUrl: r.fileKey ? fileUrl(r.fileKey) : null,
        providerId: r.providerId,
        doctorId: r.doctorId,
        providerName: r.provider?.name ?? r.providerName ?? null,
        doctorName: r.doctor?.name ?? r.doctorName ?? null,
        extractedItems: r.extractedItems.map((it) => ({ id: it.id, itemType: it.itemType, label: it.label, value: it.value, unit: it.unit })),
    }));

    const providerRows: ProviderRow[] = providers.map((p) => ({ id: p.id, name: p.name, address: p.address, phone: p.phone, website: p.website, notes: p.notes }));
    const doctorRows: DoctorRow[] = doctors.map((d) => ({ id: d.id, name: d.name, profession: d.profession, location: d.location, phone: d.phone, email: d.email, notes: d.notes, providerId: d.providerId }));

    const aiEnabled = !!process.env.ANTHROPIC_API_KEY;

    return <MedicalClient records={recordRows} providers={providerRows} doctors={doctorRows} aiEnabled={aiEnabled} />;
}
