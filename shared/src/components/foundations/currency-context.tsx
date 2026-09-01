// @ts-nocheck
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { formatCompact, formatCurrency, formatCurrency0 } from "@/lib/financial/format";

/**
 * Server-seeded display currency (ISO 4217, e.g. "USD" | "EUR"). The (app) layout reads
 * `Settings.currency` server-side and provides it here so any client component can read
 * the user's preferred currency via `useCurrency()` without prop drilling.
 *
 * Note: this is a *display* preference for formatting — it does not convert amounts.
 * Defaults to USD.
 */
const CurrencyContext = createContext<string>("USD");

export function CurrencyProvider({ value, children }: { value: string; children: ReactNode }) {
    return <CurrencyContext.Provider value={value ?? "USD"}>{children}</CurrencyContext.Provider>;
}

/** Read the user's preferred display currency. Returns an ISO 4217 code (default "USD"). */
export function useCurrency(): string {
    return useContext(CurrencyContext);
}

/**
 * Currency-formatting helpers bound to the user's preferred currency. Drop-in replacements
 * for the standalone helpers in `@/lib/financial/format` for client components — no need to
 * thread the currency through every call site.
 */
export function useFormatCurrency() {
    const currency = useCurrency();
    return useMemo(
        () => ({
            currency,
            formatCurrency: (value: number | null | undefined) => formatCurrency(value, currency),
            formatCurrency0: (value: number | null | undefined) => formatCurrency0(value, currency),
            formatCompact: (value: number | null | undefined) => formatCompact(value, currency),
        }),
        [currency],
    );
}
