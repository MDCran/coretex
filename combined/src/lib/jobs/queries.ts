import "server-only";
import type { JobDocumentKind } from "@prisma/client";
import { db } from "@/lib/db";

/** Documents of a kind with their versions (newest first) for version pickers. */
export function pickerDocs(userId: string, kind: JobDocumentKind) {
    return db.jobDocument.findMany({
        where: { userId, kind },
        orderBy: { name: "asc" },
        select: {
            id: true,
            name: true,
            versions: {
                orderBy: { versionNumber: "desc" },
                select: { id: true, versionNumber: true, label: true },
            },
        },
    });
}

export function companyOptions(userId: string) {
    return db.company.findMany({
        where: { userId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, logoKey: true, websiteDomain: true },
    });
}

/** All phases with application counts. */
export function allPhases(userId: string) {
    return db.jobPhase.findMany({
        where: { userId },
        orderBy: [{ archived: "asc" }, { startedAt: "desc" }, { createdAt: "desc" }],
        include: { _count: { select: { applications: true } } },
    });
}

/** Most recent non-archived phase, used as the default for new applications. */
export function currentPhase(userId: string) {
    return db.jobPhase.findFirst({
        where: { userId, archived: false },
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    });
}
