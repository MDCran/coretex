"use client";

import { useMemo, useState } from "react";
import {
    computePaycheck,
    FILING_LABELS,
    FREQUENCY_LABELS,
    type FilingStatus,
    type PayFrequency,
} from "@/lib/financial/paycheck";
import { formatCurrency } from "@/lib/financial/format";
import { Card, Field, NativeInput, NativeSelect, SectionHeader, Stat } from "../_components/financial-ui";

const BAR_COLORS: Record<string, string> = {
    "take-home": "var(--color-fg-success-primary)",
    federal: "var(--color-fg-brand-primary)",
    ss: "var(--color-fg-warning-primary)",
    medicare: "var(--color-utility-orange-500, #f97316)",
    state: "var(--color-fg-error-primary)",
    pretax: "var(--color-fg-quaternary)",
};

export default function PaycheckEstimatorPage() {
    const [gross, setGross] = useState(85000);
    const [filing, setFiling] = useState<FilingStatus>("single");
    const [frequency, setFrequency] = useState<PayFrequency>("biweekly");
    const [retirementPct, setRetirementPct] = useState(6);
    const [health, setHealth] = useState(2400);
    const [statePercent, setStatePercent] = useState(5);

    const result = useMemo(
        () =>
            computePaycheck({
                grossAnnual: gross,
                filingStatus: filing,
                frequency,
                pretaxRetirement: (gross * retirementPct) / 100,
                pretaxHealth: health,
                statePercent,
            }),
        [gross, filing, frequency, retirementPct, health, statePercent],
    );

    const maxBar = Math.max(...result.breakdown.map((b) => b.amount), 1);

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Paycheck estimator" description="Estimate take-home pay after federal tax, FICA, state tax and pre-tax deductions (2025 rates)." />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <Card className="flex flex-col gap-4">
                    <Field label="Gross annual salary">
                        <NativeInput type="number" min={0} step={1000} value={gross} onChange={(e) => setGross(Number(e.target.value) || 0)} />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Filing status">
                            <NativeSelect value={filing} onChange={(e) => setFiling(e.target.value as FilingStatus)}>
                                {(Object.keys(FILING_LABELS) as FilingStatus[]).map((k) => (
                                    <option key={k} value={k}>
                                        {FILING_LABELS[k]}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Pay frequency">
                            <NativeSelect value={frequency} onChange={(e) => setFrequency(e.target.value as PayFrequency)}>
                                {(Object.keys(FREQUENCY_LABELS) as PayFrequency[]).map((k) => (
                                    <option key={k} value={k}>
                                        {FREQUENCY_LABELS[k]}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <Field label="401(k) %" hint="Pre-tax">
                            <NativeInput type="number" min={0} max={90} step={1} value={retirementPct} onChange={(e) => setRetirementPct(Number(e.target.value) || 0)} />
                        </Field>
                        <Field label="Health/HSA $/yr" hint="Pre-tax">
                            <NativeInput type="number" min={0} step={100} value={health} onChange={(e) => setHealth(Number(e.target.value) || 0)} />
                        </Field>
                        <Field label="State rate %" hint="Flat estimate">
                            <NativeInput type="number" min={0} max={15} step={0.1} value={statePercent} onChange={(e) => setStatePercent(Number(e.target.value) || 0)} />
                        </Field>
                    </div>
                    <p className="text-xs text-tertiary">Estimate only — does not include credits, itemized deductions, or local taxes.</p>
                </Card>

                <div className="flex flex-col gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Stat
                            label={`Take-home · ${FREQUENCY_LABELS[frequency].toLowerCase()}`}
                            value={formatCurrency(result.takeHomePerPeriod)}
                            sub={`${formatCurrency(result.takeHomeAnnual)} / year`}
                            tone="success"
                        />
                        <Stat label="Effective tax rate" value={`${(result.effectiveRate * 100).toFixed(1)}%`} sub={`${formatCurrency(result.grossAnnual)} gross`} />
                    </div>

                    <Card className="flex flex-col gap-3">
                        <p className="text-sm font-medium text-secondary">Where your annual pay goes</p>
                        <div className="flex flex-col gap-2.5">
                            {result.breakdown.map((b) => (
                                <div key={b.key} className="flex flex-col gap-1">
                                    <div className="flex items-baseline justify-between gap-2 text-sm">
                                        <span className="text-secondary">{b.label}</span>
                                        <span className="font-medium text-primary tabular-nums">{formatCurrency(b.amount)}</span>
                                    </div>
                                    <div className="h-2 w-full overflow-hidden rounded-full bg-quaternary">
                                        <div className="h-full rounded-full" style={{ width: `${(b.amount / maxBar) * 100}%`, backgroundColor: BAR_COLORS[b.key] ?? "var(--color-fg-quaternary)" }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
