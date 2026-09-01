// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { Stat } from "../_components/financial-ui";
import { StatusRefresh } from "./status-refresh";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function ImportStatusPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getImportStatus' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getImportStatus' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading import-status...</div>;
    const { totalStatements, pctDone, done, pending, processing, failed, statementSize, transactionCount, financialDocCount, medicalRecordCount, jobDocCount, jobVersionCount, jobVersionSize, accountCount, cardCount, creditScoreCount, aiCost, recentStatements, failedStatements } = data;
    
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
                    <a href="#">
                        Open statements
                    </a>
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
                                        <a href="#">
                                            {s.fileName}
                                        </a>
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