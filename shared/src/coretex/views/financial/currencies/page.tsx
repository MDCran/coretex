// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { formatCurrency } from "../../personal/personal-ui";
import { Stat } from "../_components/financial-ui";
import { RefreshRatesButton } from "./currencies-client";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function CurrenciesPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getCurrencies' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getCurrencies' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading currencies...</div>;
    const { foreign, foreignUsdTotal, lastUpdated } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Currencies"
                description="Live USD exchange rates and your foreign-currency holdings converted to USD."
                action={<RefreshRatesButton />}
            />

            <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Rates on file" value={String(rates.length)} sub={lastUpdated ? `Updated ${lastUpdated.toLocaleDateString()}` : "Never refreshed"} />
                <Stat label="Foreign accounts" value={String(foreign.length)} />
                <Stat label="Foreign holdings (USD)" value={formatCurrency(foreignUsdTotal)} />
            </div>

            {foreign.length > 0 && (
                <Card className="flex flex-col gap-3">
                    <p className="text-sm font-medium text-secondary">Foreign-currency accounts</p>
                    <ul className="flex flex-col divide-y divide-secondary">
                        {foreign.map((a, i) => (
                            <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <span className="text-secondary">
                                    {a.name} <span className="text-tertiary">· {a.currency}</span>
                                </span>
                                <span className="text-primary tabular-nums">
                                    {formatCurrency(a.balance, a.currency ?? "USD")} <span className="text-tertiary">→ {formatCurrency(a.usd)}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            <Card className="flex flex-col gap-3">
                <p className="text-sm font-medium text-secondary">Exchange rates (USD per unit)</p>
                {rates.length === 0 ? (
                    <p className="py-4 text-sm text-tertiary">No rates yet — hit “Refresh rates” to pull the latest from the European Central Bank.</p>
                ) : (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                        {rates.map((r) => (
                            <div key={r.code} className="flex items-center justify-between gap-2 text-sm">
                                <span className="font-medium text-secondary">{r.code}</span>
                                <span className="text-tertiary tabular-nums">${Number(r.rateToUsd).toFixed(4)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );

}