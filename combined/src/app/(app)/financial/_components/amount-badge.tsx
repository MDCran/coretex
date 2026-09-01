"use client";

import { ArrowDown, ArrowUp } from "@untitledui/icons";
import { BadgeWithIcon } from "@/components/base/badges/badges";
import { formatCurrency } from "@/lib/financial/format";

/** Color-coded squared badge for transaction amounts (inflow green, outflow red). */
export function AmountBadge({ amount, showCurrency = true }: { amount: number; showCurrency?: boolean }) {
    const isInflow = amount >= 0;
    const abs = Math.abs(amount);
    const label = showCurrency ? `${formatCurrency(abs)} USD` : formatCurrency(abs);
    return (
        <BadgeWithIcon iconLeading={isInflow ? ArrowUp : ArrowDown} color={isInflow ? "success" : "error"} size="sm" type="modern">
            {isInflow ? "+" : "−"}
            {label}
        </BadgeWithIcon>
    );
}
