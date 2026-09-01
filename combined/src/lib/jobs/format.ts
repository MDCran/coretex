import { format, formatDistanceToNow } from "date-fns";

export function fmtDate(d: Date | string | null | undefined) {
    if (!d) return "—";
    return format(new Date(d), "MMM d, yyyy");
}

export function fmtDateTime(d: Date | string | null | undefined) {
    if (!d) return "—";
    return format(new Date(d), "MMM d, yyyy 'at' h:mm a");
}

export function fmtRelative(d: Date | string | null | undefined) {
    if (!d) return "Never";
    return formatDistanceToNow(new Date(d), { addSuffix: true });
}

/** Format a salary set/range, e.g. "$120,000 – $150,000" or "$130,000+". */
export function fmtSalary(min: number | null | undefined, max: number | null | undefined, currency: string | null | undefined = "USD") {
    if (min == null && max == null) return "—";
    const fmt = (n: number) =>
        new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: currency || "USD",
            maximumFractionDigits: 0,
        }).format(n);
    if (min != null && max != null) {
        if (min === max) return fmt(min);
        return `${fmt(min)} – ${fmt(max)}`;
    }
    if (min != null) return `${fmt(min)}+`;
    return `Up to ${fmt(max as number)}`;
}

/** Format a Date for an <input type="date"> (yyyy-MM-dd), or "" if null. */
export function toDateInput(d: Date | string | null | undefined) {
    if (!d) return "";
    return format(new Date(d), "yyyy-MM-dd");
}

/** Format a Date for an <input type="datetime-local"> (yyyy-MM-ddTHH:mm). */
export function toDateTimeInput(d: Date | string | null | undefined) {
    if (!d) return "";
    return format(new Date(d), "yyyy-MM-dd'T'HH:mm");
}

export function fmtFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Current time in an IANA timezone, e.g. "3:45 PM". */
export function timeInZone(tz: string, date: Date = new Date()) {
    try {
        return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
    } catch {
        return "—";
    }
}
