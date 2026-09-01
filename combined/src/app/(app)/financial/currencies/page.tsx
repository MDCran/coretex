import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { convertToUsd } from "@/lib/financial/fx";
import { formatCurrency } from "@/lib/financial/format";
import { Card, SectionHeader, Stat } from "../_components/financial-ui";
import { RefreshRatesButton } from "./currencies-client";

export const dynamic = "force-dynamic";

export default async function CurrenciesPage() {
    const user = await requireUser();

    const [rates, accounts] = await Promise.all([
        db.exchangeRate.findMany({ orderBy: { code: "asc" } }),
        db.finAccount.findMany({ where: { userId: user.id, archived: false }, select: { nickname: true, last4: true, currency: true, currentBalance: true } }),
    ]);

    const rateMap = new Map(rates.map((r) => [r.code, Number(r.rateToUsd)]));
    const lastUpdated = rates.length > 0 ? rates.reduce((a, b) => (a.asOf > b.asOf ? a : b)).asOf : null;

    const foreign = accounts
        .filter((a) => a.currency && a.currency !== "USD")
        .map((a) => ({
            name: a.nickname || `Account ••${a.last4 ?? ""}`,
            currency: a.currency,
            balance: Number(a.currentBalance),
            usd: convertToUsd(Number(a.currentBalance), a.currency, rateMap),
        }));
    const foreignUsdTotal = foreign.reduce((s, a) => s + a.usd, 0);

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
