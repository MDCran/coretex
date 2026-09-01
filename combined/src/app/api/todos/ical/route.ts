import { requireUser } from "@/lib/auth";
import { getTodosForRange } from "@/lib/todos";
import { hhmmToMinutes } from "@/lib/todos-shared";

/**
 * One-way iCal (.ics) export of scheduled todos. Downloaded in-browser with the
 * user's session — timed todos become timed VEVENTs (floating local time),
 * date-only todos become all-day events. (A subscribable feed would need a
 * per-user token; this is the authenticated export.)
 */

function escapeICS(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function pad(n: number): string {
    return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" → "YYYYMMDD". */
function icsDate(dateKey: string): string {
    return dateKey.replace(/-/g, "");
}

/** "YYYY-MM-DD" + minutes-from-midnight → floating "YYYYMMDDTHHMMSS". */
function icsDateTime(dateKey: string, minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${icsDate(dateKey)}T${pad(h)}${pad(m)}00`;
}

/** Add N days to a "YYYY-MM-DD" key (UTC), returning a new key. */
function addDaysToKey(dateKey: string, days: number): string {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

export async function GET() {
    const user = await requireUser();
    const now = new Date();
    const start = new Date(now.getTime() - 90 * 86400000);
    const end = new Date(now.getTime() + 365 * 86400000);
    const todos = await getTodosForRange(user.id, start, end);

    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

    const lines: string[] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//LifeOS//Todos//EN",
        "CALSCALE:GREGORIAN",
        "X-WR-CALNAME:LifeOS To-dos",
    ];

    for (const t of todos) {
        if (!t.date) continue;
        const sm = hhmmToMinutes(t.startTime);
        lines.push("BEGIN:VEVENT");
        lines.push(`UID:todo-${t.id}@lifeos`);
        lines.push(`DTSTAMP:${stamp}`);
        if (sm != null) {
            // Allow the end to cross midnight rather than clamping (RFC 5545 permits it).
            const endTotal = sm + (t.durationMinutes ?? 30);
            const endDateKey = endTotal >= 1440 ? addDaysToKey(t.date, Math.floor(endTotal / 1440)) : t.date;
            lines.push(`DTSTART:${icsDateTime(t.date, sm)}`);
            lines.push(`DTEND:${icsDateTime(endDateKey, endTotal % 1440)}`);
        } else {
            // All-day: RFC 5545 wants an exclusive DTEND of the next day.
            lines.push(`DTSTART;VALUE=DATE:${icsDate(t.date)}`);
            lines.push(`DTEND;VALUE=DATE:${icsDate(addDaysToKey(t.date, 1))}`);
        }
        lines.push(`SUMMARY:${escapeICS(t.title)}`);
        if (t.body) lines.push(`DESCRIPTION:${escapeICS(t.body)}`);
        lines.push(`STATUS:${t.status === "DONE" ? "CONFIRMED" : t.status === "SKIPPED" ? "CANCELLED" : "TENTATIVE"}`);
        if (t.priority === "URGENT" || t.priority === "HIGH") lines.push("PRIORITY:1");
        else if (t.priority === "MEDIUM") lines.push("PRIORITY:5");
        else if (t.priority === "LOW") lines.push("PRIORITY:7");
        lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    // iCal requires CRLF line endings.
    const body = lines.join("\r\n") + "\r\n";

    return new Response(body, {
        headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'attachment; filename="lifeos-todos.ics"',
            "Cache-Control": "no-store",
        },
    });
}
