import { eachDayOfInterval, startOfDay, endOfMonth, startOfMonth } from "date-fns";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { annualOccurrencesInWindow } from "@/lib/calendar/annual-dates";
import { SocialCalendarClient, type BatteryDay, type SocialCalEvent } from "@/components/social/social-calendar-client";

export const dynamic = "force-dynamic";

export default async function SocialCalendarPage() {
    const user = await requireUser();
    const now = new Date();
    // Window: 2 months back through 2 months forward so month/week/day navigation
    // shows real data (mirrors the main calendar).
    const monthStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 2, 1));
    const monthEnd = endOfMonth(new Date(now.getFullYear(), now.getMonth() + 2, 1));
    const rangeStart = monthStart;
    const rangeEnd = monthEnd;

    const [batteryRows, socialEvents, contacts, contactDates] = await Promise.all([
        db.socialBattery.findMany({
            where: { userId: user.id, date: { gte: rangeStart, lte: rangeEnd } },
            orderBy: { date: "asc" },
        }),
        db.socialEvent.findMany({
            where: { userId: user.id, eventDate: { gte: monthStart, lte: monthEnd } },
            select: { id: true, name: true, eventDate: true },
            orderBy: { eventDate: "asc" },
        }),
        db.socialContact.findMany({
            where: { userId: user.id, active: true, birthday: { not: null } },
            select: { id: true, displayName: true, birthday: true },
        }),
        db.contactDate.findMany({
            where: { contact: { userId: user.id, active: true } },
            select: { id: true, dateType: true, dateValue: true, contact: { select: { id: true, displayName: true } } },
        }),
    ]);

    const byDate = new Map(batteryRows.map((r) => [startOfDay(r.date).toISOString().slice(0, 10), r.energyLevel]));
    const battery: BatteryDay[] = eachDayOfInterval({ start: rangeStart, end: rangeEnd }).map((d) => ({
        date: d.toISOString(),
        energy: byDate.get(d.toISOString().slice(0, 10)) ?? null,
    }));

    const events: SocialCalEvent[] = [
        ...socialEvents
            .filter((e) => e.eventDate)
            .map((e) => ({
                id: `se-${e.id}`,
                title: e.name,
                date: e.eventDate!.toISOString(),
                href: "/social/events",
            })),
        ...contacts.flatMap((c) => {
            if (!c.birthday) return [];
            return annualOccurrencesInWindow(c.birthday, monthStart, monthEnd).map((occ) => ({
                id: `bday-${c.id}-${occ.toISOString().slice(0, 10)}`,
                title: `Birthday · ${c.displayName}`,
                date: occ.toISOString(),
                href: `/social/contacts/${c.id}`,
            }));
        }),
        ...contactDates.flatMap((d) =>
            annualOccurrencesInWindow(d.dateValue, monthStart, monthEnd).map((occ) => ({
                id: `cd-${d.id}-${occ.toISOString().slice(0, 10)}`,
                title: `${d.dateType} · ${d.contact.displayName}`,
                date: occ.toISOString(),
                href: `/social/contacts/${d.contact.id}`,
            })),
        ),
    ].sort((a, b) => a.date.localeCompare(b.date));

    return <SocialCalendarClient battery={battery} events={events} />;
}
