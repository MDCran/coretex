import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { StatusRefresh } from "./status-refresh";

export const dynamic = "force-dynamic";

type Status = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

const STATUS_LABELS: Record<Status, string> = {
    PENDING: "Pending",
    PROCESSING: "Processing",
    DONE: "Done",
    FAILED: "Failed",
};

const STATUS_CLASSES: Record<Status, string> = {
    PENDING: "bg-warning-secondary text-warning-primary",
    PROCESSING: "bg-brand-secondary text-brand-primary",
    DONE: "bg-success-secondary text-success-primary",
    FAILED: "bg-error-secondary text-error-primary",
};

function countOf(groups: Array<{ processingStatus: Status; _count: { _all: number } }>, status: Status): number {
    return groups.find((g) => g.processingStatus === status)?._count._all ?? 0;
}

function formatBytes(bytes: number | null | undefined): string {
    const n = bytes ?? 0;
    if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
            <p className="text-sm text-tertiary">{label}</p>
            <p className="mt-1 text-display-xs font-semibold text-primary">{value}</p>
            {sub && <p className="mt-1 text-xs text-tertiary">{sub}</p>}
        </div>
    );
}

function StatusPill({ status }: { status: Status }) {
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}>{STATUS_LABELS[status]}</span>;
}

export default async function ImportStatusPage() {
    const user = await requireUser();

    const [
        statementGroups,
        statementSize,
        transactionCount,
        financialDocCount,
        medicalRecordCount,
        jobDocCount,
        jobVersionCount,
        jobVersionSize,
        accountCount,
        cardCount,
        creditScoreCount,
        aiUsage,
        recentStatements,
        failedStatements,
    ] = await Promise.all([
        db.finStatement.groupBy({ by: ["processingStatus"], where: { userId: user.id }, _count: { _all: true } }),
        db.finStatement.aggregate({ where: { userId: user.id }, _sum: { fileSize: true } }),
        db.finTransaction.count({ where: { userId: user.id, source: "STATEMENT" } }),
        db.taxDocument.count({ where: { userId: user.id, notes: { startsWith: "Imported from NEEDS_HANDLING" } } }),
        db.medicalRecord.count({ where: { userId: user.id, notes: { startsWith: "Imported from NEEDS_HANDLING" } } }),
        db.jobDocument.count({ where: { userId: user.id } }),
        db.jobDocumentVersion.count({ where: { document: { userId: user.id } } }),
        db.jobDocumentVersion.aggregate({ where: { document: { userId: user.id } }, _sum: { fileSize: true } }),
        db.finAccount.count({ where: { userId: user.id } }),
        db.creditCard.count({ where: { userId: user.id } }),
        db.creditScoreEntry.count({ where: { userId: user.id } }),
        db.aiCall.aggregate({
            where: { userId: user.id, purpose: { in: ["statement-extract", "transaction-categorize"] } },
            _sum: { costUsd: true, inputTokens: true, outputTokens: true },
            _count: { _all: true },
        }),
        db.finStatement.findMany({
            where: { userId: user.id },
            orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
            take: 12,
            include: { _count: { select: { transactions: true } } },
        }),
        db.finStatement.findMany({
            where: { userId: user.id, processingStatus: "FAILED" },
            orderBy: { processedAt: "desc" },
            take: 8,
        }),
    ]);

    const totalStatements = statementGroups.reduce((sum, g) => sum + g._count._all, 0);
    const done = countOf(statementGroups, "DONE");
    const pending = countOf(statementGroups, "PENDING");
    const processing = countOf(statementGroups, "PROCESSING");
    const failed = countOf(statementGroups, "FAILED");
    const pctDone = totalStatements > 0 ? Math.round((done / totalStatements) * 100) : 0;
    const aiCost = aiUsage._sum.costUsd != null ? Number(aiUsage._sum.costUsd).toFixed(4) : "0.0000";

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-display-xs font-semibold text-primary">Import status</h1>
                    <p className="mt-1 text-sm text-tertiary">NEEDS_HANDLING uploads and statement extraction for {user.email}.</p>
                </div>
                <StatusRefresh />
            </div>

            <div className="rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium text-secondary">Statement extraction</p>
                        <p className="mt-1 text-sm text-tertiary">
                            {done} of {totalStatements} complete ({pctDone}%)
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <StatusPill status="DONE" />
                        {processing > 0 && <StatusPill status="PROCESSING" />}
                        {pending > 0 && <StatusPill status="PENDING" />}
                        {failed > 0 && <StatusPill status="FAILED" />}
                    </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-quaternary">
                    <div className="h-full rounded-full bg-success-solid transition-all" style={{ width: `${pctDone}%` }} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                    <Stat label="Done" value={done} />
                    <Stat label="Pending" value={pending} />
                    <Stat label="Processing" value={processing} />
                    <Stat label="Failed" value={failed} />
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
                <Stat label="Accounts/cards" value={`${accountCount} / ${cardCount}`} sub="Financial accounts / credit cards" />
                <Stat label="Statement transactions" value={transactionCount} sub={`${formatBytes(statementSize._sum.fileSize)} of statement PDFs`} />
                <Stat label="AI calls" value={aiUsage._count._all} sub={`$${aiCost}, ${aiUsage._sum.inputTokens ?? 0} in / ${aiUsage._sum.outputTokens ?? 0} out tokens`} />
                <Stat label="Financial docs" value={financialDocCount} sub="Tax, legal, cashflow, credit, personal docs" />
                <Stat label="Health records" value={medicalRecordCount} sub="Imported medical files" />
                <Stat label="Career docs" value={jobDocCount} sub={`${jobVersionCount} versions, ${formatBytes(jobVersionSize._sum.fileSize)}`} />
                <Stat label="Credit scores" value={creditScoreCount} sub="Parsed from credit score history" />
            </div>

            {failedStatements.length > 0 && (
                <div className="rounded-xl bg-primary ring-1 ring-secondary ring-inset">
                    <div className="border-b border-secondary px-5 py-4">
                        <h2 className="text-md font-semibold text-primary">Failures to review</h2>
                    </div>
                    <div className="divide-y divide-secondary">
                        {failedStatements.map((s) => (
                            <div key={s.id} className="px-5 py-3">
                                <p className="text-sm font-medium text-primary">{s.fileName}</p>
                                <p className="mt-1 text-xs text-error-primary">{s.processingError}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="overflow-hidden rounded-xl bg-primary ring-1 ring-secondary ring-inset">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-secondary px-5 py-4">
                    <h2 className="text-md font-semibold text-primary">Recent statements</h2>
                    <Link href="/financial/statements" className="text-sm font-medium text-brand-secondary hover:text-brand-secondary_hover">
                        Open statements
                    </Link>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-3xl text-sm">
                        <thead className="bg-secondary">
                            <tr className="text-left text-xs font-medium text-tertiary">
                                <th className="px-5 py-3">File</th>
                                <th className="px-5 py-3">Status</th>
                                <th className="px-5 py-3">Transactions</th>
                                <th className="px-5 py-3">Processed</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-secondary">
                            {recentStatements.map((s) => (
                                <tr key={s.id}>
                                    <td className="max-w-md px-5 py-3">
                                        <Link href={fileUrl(s.fileKey, { name: s.fileName })} className="truncate text-secondary hover:text-primary hover:underline">
                                            {s.fileName}
                                        </Link>
                                    </td>
                                    <td className="px-5 py-3">
                                        <StatusPill status={s.processingStatus} />
                                    </td>
                                    <td className="px-5 py-3 text-secondary">{s._count.transactions}</td>
                                    <td className="px-5 py-3 text-tertiary">{s.processedAt ? s.processedAt.toLocaleString() : "Not yet"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
