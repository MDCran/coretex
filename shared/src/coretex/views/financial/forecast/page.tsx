// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { formatCurrency } from "../../personal/personal-ui";
import { Stat } from "../_components/financial-ui";
import { ForecastChart } from "./forecast-chart";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function ForecastPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getForecast' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getForecast' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading forecast...</div>;
    const { chartData, hasData, netMonthly } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Cash flow forecast"
                description="Projects your liquid balance 30/60/90 days out from recurring income, bills and average spending."
            />

            {!hasData ? (
                <Card>
                    <p className="text-sm text-tertiary">Add a checking/savings account, some income, and recurring bills to see a forecast.</p>
                </Card>
            ) : (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Today" value={formatCurrency(startBalance)} sub="liquid cash" />
                        <Stat label="In 30 days" value={formatCurrency(forecast.d30)} tone={forecast.d30 < 0 ? "error" : undefined} />
                        <Stat label="In 60 days" value={formatCurrency(forecast.d60)} tone={forecast.d60 < 0 ? "error" : undefined} />
                        <Stat label="In 90 days" value={formatCurrency(forecast.d90)} tone={forecast.d90 < 0 ? "error" : undefined} />
                    </div>

                    <Card className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-secondary">Projected balance</p>
                            <p className="text-xs text-tertiary">
                                Net {netMonthly >= 0 ? "+" : ""}
                                {formatCurrency(netMonthly)}/mo · {formatCurrency(forecast.totalBills)} in bills over 90 days
                            </p>
                        </div>
                        <ForecastChart data={chartData} />
                    </Card>

                    {forecast.firstNegativeDay != null ? (
                        <BloomCard bloom="error">
                            <p className="text-sm font-semibold text-primary">Heads up — projected shortfall</p>
                            <p className="text-sm text-tertiary">
                                At this rate your liquid balance dips below $0 around {fmtDay(forecast.firstNegativeDay)} (in {forecast.firstNegativeDay} days). Lowest
                                point: {formatCurrency(forecast.lowest.balance)} on {fmtDay(forecast.lowest.day)}.
                            </p>
                        </BloomCard>
                    ) : (
                        <BloomCard bloom="success">
                            <p className="text-sm font-semibold text-primary">On track</p>
                            <p className="text-sm text-tertiary">
                                Your balance stays positive across the next 90 days. Lowest projected point: {formatCurrency(forecast.lowest.balance)} on{" "}
                                {fmtDay(forecast.lowest.day)}.
                            </p>
                        </BloomCard>
                    )}
                </>
            )}
        </div>
    );

}