// @ts-nocheck
/**
 * Multi-currency helpers. `convertToUsd` is pure; `fetchUsdRates` pulls live rates from
 * the free Frankfurter API (ECB data, no key required).
 */

export const FX_CURRENCIES = [
    "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "INR", "MXN", "BRL", "SEK", "NOK", "DKK", "PLN", "NZD", "SGD", "HKD", "ZAR", "KRW",
];

export interface UsdRate {
    code: string;
    /** USD per 1 unit of `code`. USD = 1. */
    rateToUsd: number;
}

/** Convert an amount in `currency` to USD using a code→rateToUsd map. Falls back to face value. */
export function convertToUsd(amount: number, currency: string | null | undefined, rates: Map<string, number>): number {
    if (!currency || currency === "USD") return amount;
    const r = rates.get(currency);
    return r != null && r > 0 ? amount * r : amount;
}

/** Fetch current USD rates for all supported currencies in one call. */
export async function fetchUsdRates(): Promise<UsdRate[]> {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", { cache: "no-store" });
    if (!res.ok) throw new Error("Couldn't reach the exchange-rate service.");
    const data = (await res.json()) as { rates?: Record<string, number> };
    const out: UsdRate[] = [{ code: "USD", rateToUsd: 1 }];
    for (const [code, perUsd] of Object.entries(data.rates ?? {})) {
        // API gives units-of-X per 1 USD; invert to get USD per 1 X.
        if (typeof perUsd === "number" && perUsd > 0) out.push({ code, rateToUsd: 1 / perUsd });
    }
    return out;
}
