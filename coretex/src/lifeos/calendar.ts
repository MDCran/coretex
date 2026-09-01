import { getCalendar as getFinancialCalendar } from "./financial.js";
import { getPersonalCalendar } from "./personal-calendar.js";
import { normalizeUnifiedSources } from "../calendar/unified-feed.js";

const DAY_MS = 86_400_000;

/**
 * Unified, read-only database calendar feed. Runtime-only workspace records
 * (agents/projects/email) are merged by the orchestrator/UI with the same pure
 * normalizer because they do not live in the LifeOS database.
 */
export async function getUnifiedCalendarContext(userId: string, payload?: Record<string, unknown>) {
    const [personal, financial] = await Promise.all([
        getPersonalCalendar(userId, payload),
        getFinancialCalendar(userId),
    ]);
    const rangeStart = new Date(`${personal.range.start}T00:00:00`).getTime();
    const rangeEnd = new Date(`${personal.range.end}T00:00:00`).getTime() + DAY_MS - 1;
    const events = normalizeUnifiedSources({
        personal: personal.events,
        financial: financial.events,
        range: { start: rangeStart, end: rangeEnd },
    });

    const counts = events.reduce<Record<string, number>>((result, event) => {
        const kind = event.source?.kind ?? "user";
        result[kind] = (result[kind] ?? 0) + 1;
        return result;
    }, {});

    return {
        range: personal.range,
        events,
        counts,
        sources: ["financial", "social", "workout", "nutrition", "health", "todo"],
    };
}
