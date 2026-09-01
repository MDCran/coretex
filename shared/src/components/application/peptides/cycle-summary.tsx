// @ts-nocheck
import { AlertTriangle, CheckCircle } from "@untitledui/icons";
import type { Peptide } from "@/lib/peptides/types";
import { deriveCycle, mgToUnit } from "@/lib/peptides/dosing";
import { fmt } from "@/lib/peptides/format";
import { ProgressBarBase } from "@/components/base/progress-indicators/progress-indicators";
import { cx } from "@/utils/cx";
import { Card, CardBody, CardHeader, CardTitle } from "./card";

export function CycleSummary({ peptide }: { peptide: Peptide }) {
    const { cycleTotalMg, availableMg, vialsNeeded, shortfallMg, overBudget } = deriveCycle(peptide);
    const u = peptide.doseUnit;
    const used = mgToUnit(cycleTotalMg, u);
    const avail = mgToUnit(availableMg, u);
    const pct = availableMg > 0 ? Math.min(100, (cycleTotalMg / availableMg) * 100) : cycleTotalMg > 0 ? 100 : 0;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Cycle Summary</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-base text-secondary">
                        <span className={cx("font-mono tabular-nums", overBudget ? "text-error-primary" : "text-primary")}>{fmt(used, 2)}</span>{" "}
                        <span className="text-tertiary">of</span> <span className="font-mono text-primary tabular-nums">{fmt(avail, 2)}</span> {u}
                    </span>
                    <span className="text-sm text-tertiary">
                        Vials needed: <span className={cx("font-mono tabular-nums", overBudget && "text-error-primary")}>{vialsNeeded}</span> · owned:{" "}
                        <span className="font-mono tabular-nums">{fmt(peptide.vialsOwned)}</span>
                    </span>
                </div>

                <ProgressBarBase value={pct} className="h-3" progressClassName={overBudget ? "bg-fg-error-primary" : undefined} />

                {overBudget ? (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-error-primary">
                        <AlertTriangle className="size-4" />
                        Short by <span className="font-mono tabular-nums">{fmt(mgToUnit(shortfallMg, u), 2)}</span> {u} — {Math.max(0, vialsNeeded - peptide.vialsOwned)} more
                        vial(s) needed.
                    </p>
                ) : (
                    <p className="flex items-center gap-1.5 text-sm text-success-primary">
                        <CheckCircle className="size-4" />
                        Within supply ({fmt(avail - used, 2)} {u} headroom).
                    </p>
                )}
            </CardBody>
        </Card>
    );
}
