import "server-only";

import { db } from "@/lib/db";

/** Trim a FormData string field, returning null when empty. */
export function str(formData: FormData, k: string): string | null {
    const v = formData.get(k);
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
}

/** Parse an integer FormData field within optional bounds, or null. */
export function int(formData: FormData, k: string, min?: number, max?: number): number | null {
    const s = str(formData, k);
    if (s === null) return null;
    const n = parseInt(s, 10);
    if (Number.isNaN(n)) return null;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
}

/** Parse a boolean checkbox field ("on" / "true" / "1"). */
export function bool(formData: FormData, k: string): boolean {
    const v = formData.get(k);
    return v === "on" || v === "true" || v === "1";
}

/** Parse a date-only field into a Date (local midnight), or null. */
export function date(formData: FormData, k: string): Date | null {
    const s = str(formData, k);
    if (!s) return null;
    return new Date(`${s}T00:00:00`);
}

/** Parse a datetime-local field into a Date, or null. */
export function dateTime(formData: FormData, k: string): Date | null {
    const s = str(formData, k);
    if (!s) return null;
    return new Date(s);
}

/** Verify a contact belongs to the user, throwing if not. Returns the contact. */
export async function ownedContact(userId: string, id: string) {
    const contact = await db.socialContact.findFirst({ where: { id, userId } });
    if (!contact) throw new Error("Contact not found");
    return contact;
}

/** Verify (by child relation) that a contact belongs to the user. Throws if not. */
export async function assertContactOwner(userId: string, contactId: string) {
    const contact = await db.socialContact.findFirst({ where: { id: contactId, userId }, select: { id: true } });
    if (!contact) throw new Error("Contact not found");
}

/** Recompute lastContactAt for a contact from its most recent interaction/communication. */
export async function recomputeLastContact(contactId: string) {
    const [interaction, comm] = await Promise.all([
        db.socialInteraction.findFirst({ where: { contactId }, orderBy: { date: "desc" }, select: { date: true } }),
        db.communicationLog.findFirst({ where: { contactId }, orderBy: { date: "desc" }, select: { date: true } }),
    ]);
    const dates = [interaction?.date, comm?.date].filter(Boolean) as Date[];
    const latest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
    await db.socialContact.update({ where: { id: contactId }, data: { lastContactAt: latest } });
}
