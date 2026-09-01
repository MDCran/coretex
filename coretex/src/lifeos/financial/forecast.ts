// @ts-nocheck
/**
 * Cash-flow forecast — projects a liquid-cash balance forward day by day. Pure +
 * client-safe.
 *
 * The model combines (a) smoothed daily income and discretionary spending derived from
 * trailing averages with (b) discrete recurring bills (subscriptions, debt minimums,
 * card payments) placed on their real due dates. This gives a realistic saw-tooth
 * balance curve and surfaces the projected balance at 30/60/90 days plus the lowest
 * point and the first day the balance would go negative.
 */

export interface BillEvent {
    /** Days from today (0 = today). */
    dayOffset: number;
    /** Positive number; subtracted from balance on that day. */
    amount: number;
    label: string;
}

export interface ForecastInput {
    startBalance: number;
    /** Smoothed income per day (e.g. monthly income ÷ 30). */
    dailyIncome: number;
    /** Smoothed discretionary outflow per day, EXCLUDING the discrete bills below. */
    dailyDiscretionary: number;
    bills: BillEvent[];
    horizonDays?: number;
}

export interface ForecastPoint {
    day: number;
    balance: number;
}

export interface ForecastResult {
    series: ForecastPoint[];
    d30: number;
    d60: number;
    d90: number;
    lowest: { day: number; balance: number };
    firstNegativeDay: number | null;
    totalBills: number;
}

export function buildForecast(input: ForecastInput): ForecastResult {
    const horizon = input.horizonDays ?? 90;
    const billsByDay = new Map<number, number>();
    let totalBills = 0;
    for (const b of input.bills) {
        if (b.dayOffset < 0 || b.dayOffset > horizon) continue;
        billsByDay.set(b.dayOffset, (billsByDay.get(b.dayOffset) ?? 0) + b.amount);
        totalBills += b.amount;
    }

    const net = input.dailyIncome - input.dailyDiscretionary;
    const series: ForecastPoint[] = [{ day: 0, balance: round(input.startBalance) }];
    let balance = input.startBalance;
    let lowest = { day: 0, balance: input.startBalance };
    let firstNegativeDay: number | null = input.startBalance < 0 ? 0 : null;

    for (let day = 1; day <= horizon; day++) {
        balance += net;
        balance -= billsByDay.get(day) ?? 0;
        if (firstNegativeDay === null && balance < 0) firstNegativeDay = day;
        if (balance < lowest.balance) lowest = { day, balance };
        series.push({ day, balance: round(balance) });
    }

    const at = (d: number) => round(series[Math.min(d, horizon)]?.balance ?? balance);
    return {
        series,
        d30: at(30),
        d60: at(60),
        d90: at(90),
        lowest: { day: lowest.day, balance: round(lowest.balance) },
        firstNegativeDay,
        totalBills: round(totalBills),
    };
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Days between recurring charges for a subscription cadence. */
export function cadenceDays(cadence: string): number {
    switch (cadence) {
        case "WEEKLY":
            return 7;
        case "YEARLY":
            return 365;
        case "MONTHLY":
            return 30;
        default:
            return 30;
    }
}

/**
 * Expand a recurring charge into all of its occurrences within `horizonDays`, starting
 * from `firstChargeOffset` (days from today) and repeating every `everyDays`.
 */
export function expandRecurring(firstChargeOffset: number, everyDays: number, amount: number, label: string, horizonDays = 90): BillEvent[] {
    const out: BillEvent[] = [];
    if (everyDays <= 0 || amount <= 0) return out;
    let offset = firstChargeOffset;
    // Catch up to today if the first charge is in the past.
    while (offset < 0) offset += everyDays;
    for (; offset <= horizonDays; offset += everyDays) {
        out.push({ dayOffset: Math.round(offset), amount, label });
    }
    return out;
}
