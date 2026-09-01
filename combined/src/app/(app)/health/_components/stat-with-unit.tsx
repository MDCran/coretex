"use client";

import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";

/** Stat block that shows the measurement unit on hover. */
export function StatWithUnit({
    label,
    value,
    sub,
    unitHint,
}: {
    label: string;
    value: string;
    sub?: string;
    unitHint?: string;
}) {
    const body = (
        <div className="flex flex-col gap-1 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
            <p className="text-sm text-tertiary">{label}</p>
            <p className="text-display-xs font-semibold text-primary">{value}</p>
            {sub && <p className="text-xs text-tertiary">{sub}</p>}
        </div>
    );

    if (!unitHint) return body;

    return (
        <Tooltip title={label} description={`Values shown in ${unitHint}`}>
            <TooltipTrigger className="block w-full text-left">{body}</TooltipTrigger>
        </Tooltip>
    );
}
