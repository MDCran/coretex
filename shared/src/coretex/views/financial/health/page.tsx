// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { ProgressBar } from "react-aria-components";
import { formatCurrency } from "../../personal/personal-ui";
import { Stat } from "../_components/financial-ui";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function HealthPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getHealth' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getHealth' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading health...</div>;
    const { score, status, hasData, dash, CIRC } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Financial health score"
                description="A composite of your savings rate, emergency fund, debt-to-income, credit utilization and budget adherence."
            />

            {!hasData ? (
                <Card>
                    <p className="text-sm text-tertiary">
                        Add income, accounts, cards or budgets to generate your score. We use the last 90 days of income and spending plus your current balances.
                    </p>
                </Card>
            ) : (
                <>
                    <BloomCard bloom={statusColor[status]}>
                        <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
                            <div className="relative shrink-0">
                                <svg viewBox="0 0 120 120" className="size-40">
                                    <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-bg-quaternary)" strokeWidth="12" />
                                    <circle
                                        cx="60"
                                        cy="60"
                                        r={R}
                                        fill="none"
                                        stroke={statusHex[status]}
                                        strokeWidth="12"
                                        strokeLinecap="round"
                                        strokeDasharray={`${dash} ${CIRC}`}
                                        transform="rotate(-90 60 60)"
                                    />
                                    <text x="60" y="56" textAnchor="middle" className="fill-primary text-3xl font-bold" style={{ fontSize: 30 }}>
                                        {result.score}
                                    </text>
                                    <text x="60" y="78" textAnchor="middle" className="fill-tertiary" style={{ fontSize: 12 }}>
                                        / 100
                                    </text>
                                </svg>
                            </div>
                            <div className="flex flex-col gap-1 text-center sm:text-left">
                                <p className="text-display-xs font-semibold text-primary">
                                    {result.label} <span className="text-tertiary">· {result.grade}</span>
                                </p>
                                <p className="max-w-md text-sm text-tertiary">
                                    Scored from {result.components.length} indicator{result.components.length === 1 ? "" : "s"}. Improve the lowest bars below to raise
                                    your score the fastest.
                                </p>
                            </div>
                        </div>
                    </BloomCard>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {result.components.map((c) => (
                            <Card key={c.key} className="flex flex-col gap-3">
                                <div className="flex items-baseline justify-between gap-2">
                                    <p className="text-sm font-medium text-secondary">{c.label}</p>
                                    <p className="text-sm font-semibold text-primary tabular-nums">{c.value}</p>
                                </div>
                                <ProgressBar value={c.score} max={100} color={statusColor[c.status]} />
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs text-tertiary">{c.detail}</p>
                                    <span className="shrink-0 text-xs font-medium text-tertiary tabular-nums">{c.score}/100</span>
                                </div>
                            </Card>
                        ))}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Avg monthly income" value={formatCurrency(monthlyIncome)} sub="trailing 90 days" />
                        <Stat label="Avg monthly spending" value={formatCurrency(monthlySpending)} sub="trailing 90 days" />
                        <Stat label="Liquid savings" value={formatCurrency(liquidSavings)} sub="cash + savings" />
                        <Stat label="Monthly debt payments" value={formatCurrency(monthlyDebtPayments)} sub="loan + card minimums" />
                    </div>
                </>
            )}
        </div>
    );

}