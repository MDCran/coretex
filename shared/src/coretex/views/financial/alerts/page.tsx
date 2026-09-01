// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function AlertsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getAlerts' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getAlerts' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading alerts...</div>;
    const { alerts, counts } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Smart alerts"
                description="Low balances, due bills, overdrafts, high utilization, budget overruns and unusual charges — surfaced automatically."
            />

            {alerts.length === 0 ? (
                <BloomCard bloom="success">
                    <div className="flex items-center gap-3">
                        <FeaturedIcon icon={CheckCircle} color="success" theme="light" size="md" />
                        <div>
                            <p className="text-sm font-semibold text-primary">All clear</p>
                            <p className="text-sm text-tertiary">No alerts right now — balances are healthy, bills are current, and spending is on track.</p>
                        </div>
                    </div>
                </BloomCard>
            ) : (
                <>
                    <p className="text-sm text-tertiary">
                        {counts.error > 0 && <span className="font-medium text-error-primary">{counts.error} urgent</span>}
                        {counts.error > 0 && (counts.warning > 0 || counts.info > 0) && " · "}
                        {counts.warning > 0 && <span className="font-medium text-warning-primary">{counts.warning} warning{counts.warning === 1 ? "" : "s"}</span>}
                        {counts.warning > 0 && counts.info > 0 && " · "}
                        {counts.info > 0 && <span className="text-tertiary">{counts.info} info</span>}
                    </p>
                    <div className="flex flex-col gap-3">
                        {alerts.map((a) => {
                            const Icon = severityIcon[a.severity];
                            return (
                                <Card key={a.id} className="flex items-start gap-3">
                                    <FeaturedIcon icon={Icon} color={severityColor[a.severity]} theme="light" size="md" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-primary">{a.title}</p>
                                        <p className="text-sm text-tertiary">{a.detail}</p>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );

}