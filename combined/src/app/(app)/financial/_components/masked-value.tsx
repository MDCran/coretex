"use client";

import { useState } from "react";
import { Eye, EyeOff } from "@untitledui/icons";

/**
 * Displays a sensitive value (account number, card number, CVV) masked by default
 * with a reveal toggle. `mask` controls how the hidden form looks.
 */
export function MaskedValue({ value, mask }: { value: string | null | undefined; mask?: string }) {
    const [shown, setShown] = useState(false);
    if (!value) return <span className="text-tertiary">—</span>;
    const masked = mask ?? `•••• ${value.replace(/\D/g, "").slice(-4) || "••••"}`;
    return (
        <span className="inline-flex items-center gap-2">
            <span className="font-mono text-sm text-primary tabular-nums">{shown ? value : masked}</span>
            <button
                type="button"
                onClick={() => setShown((s) => !s)}
                aria-label={shown ? "Hide" : "Reveal"}
                className="rounded-md p-1 text-fg-quaternary transition duration-100 ease-linear hover:bg-primary_hover hover:text-fg-quaternary_hover"
            >
                {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
        </span>
    );
}
