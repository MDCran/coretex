import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cadenceDays, expandRecurring } from "@/lib/financial/forecast";
import { SectionHeader } from "../_components/financial-ui";
import { BillCalendar, type BillCalendarEvent } from "./bill-calendar";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function BillCalendarPage() {
    const user = await requireUser();
    const now = new Date();
    const horizon = 75; // days forward to project recurring charges

    const [subs, cards] = await Promise.all([
        db.finSubscription.findMany({ where: { userId: user.id, status: "ACTIVE" }, select: { id: true, name: true, merchant: true, amount: true, cadence: true, nextChargeOn: true } }),
        db.creditCard.findMany({ where: { userId: user.id, archived: false }, select: { id: true, nickname: true, productName: true, minimumPayment: true, paymentDueAt: true, paymentOverdue: true } }),
    ]);

    const events: BillCalendarEvent[] = [];

    const dateForOffset = (offset: number) => new Date(now.getTime() + offset * DAY_MS);

    for (const s of subs) {
        if (!s.nextChargeOn || Number(s.amount) <= 0) continue;
        const firstOffset = Math.round((s.nextChargeOn.getTime() - now.getTime()) / DAY_MS);
        const occ = expandRecurring(firstOffset, cadenceDays(s.cadence), Number(s.amount), s.name || s.merchant, horizon);
        occ.forEach((o, i) =>
            events.push({ id: `sub-${s.id}-${i}`, date: ymd(dateForOffset(o.dayOffset)), label: o.label, amount: o.amount, kind: "subscription", overdue: false }),
        );
    }

    for (const c of cards) {
        const amt = Number(c.minimumPayment ?? 0);
        if (amt <= 0 || !c.paymentDueAt) continue;
        const firstOffset = Math.round((c.paymentDueAt.getTime() - now.getTime()) / DAY_MS);
        const label = `${c.nickname || c.productName || "Card"} payment`;
        // Past-due if the stored due date is behind us or the card is flagged overdue.
        if (firstOffset < 0 || c.paymentOverdue) {
            events.push({ id: `card-${c.id}-due`, date: ymd(c.paymentDueAt), label, amount: amt, kind: "card", overdue: true });
        }
        const occ = expandRecurring(Math.max(firstOffset, 0), 30, amt, label, horizon);
        occ.forEach((o, i) => events.push({ id: `card-${c.id}-${i}`, date: ymd(dateForOffset(o.dayOffset)), label: o.label, amount: o.amount, kind: "card", overdue: false }));
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Bill calendar" description="Upcoming subscription charges and card payment due dates, with overdue warnings." />
            <BillCalendar events={events} todayIso={ymd(now)} />
        </div>
    );
}
