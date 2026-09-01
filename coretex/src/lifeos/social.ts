import { prisma } from "../db/prisma.js";
import { resolveAssetUrl } from "./assets.js";
import { ollamaJson } from "./financial.js";

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const isoDay = (value: Date) => value.toISOString().slice(0, 10);

function daysUntilAnnual(value: Date, now = new Date()): number {
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const thisYear = new Date(Date.UTC(now.getFullYear(), value.getUTCMonth(), value.getUTCDate()));
    const next = thisYear.getTime() < today
        ? new Date(Date.UTC(now.getFullYear() + 1, value.getUTCMonth(), value.getUTCDate()))
        : thisYear;
    return Math.max(0, Math.round((next.getTime() - today) / 86_400_000));
}

function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function contactSummary(contact: {
    id: string;
    displayName: string;
    avatarKey: string | null;
    relationshipType: string | null;
    birthday: Date | null;
    occupation: string | null;
    companyOrSchool: string | null;
    timezone: string | null;
    closenessScore: number | null;
    trustScore: number | null;
    innerCircle: boolean;
    stayInTouch: boolean;
    stayInTouchDays: number | null;
    lastContactAt: Date | null;
    active: boolean;
}) {
    return {
        ...contact,
        avatarUrl: resolveAssetUrl(contact.avatarKey),
        birthday: iso(contact.birthday),
        lastContactAt: iso(contact.lastContactAt),
    };
}

export async function getOverview(userId: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 29 * 86_400_000);
    const [contacts, eventCount, dueReminders, battery, interactions, contactDates, drafts] = await Promise.all([
        prisma.socialContact.findMany({
            where: { userId, active: true },
            orderBy: { displayName: "asc" },
            select: {
                id: true,
                displayName: true,
                avatarKey: true,
                relationshipType: true,
                birthday: true,
                occupation: true,
                companyOrSchool: true,
                timezone: true,
                closenessScore: true,
                trustScore: true,
                innerCircle: true,
                stayInTouch: true,
                stayInTouchDays: true,
                lastContactAt: true,
                active: true,
            },
        }),
        prisma.socialEvent.count({ where: { userId } }),
        prisma.contactReminder.count({ where: { contact: { userId }, completed: false, scheduledFor: { lte: now } } }),
        prisma.socialBattery.findMany({ where: { userId, date: { gte: thirtyDaysAgo } }, orderBy: { date: "asc" } }),
        prisma.socialInteraction.findMany({
            where: { contact: { userId } },
            orderBy: { date: "desc" },
            take: 8,
            include: { contact: { select: { id: true, displayName: true } } },
        }),
        prisma.contactDate.findMany({
            where: { contact: { userId, active: true } },
            include: { contact: { select: { id: true, displayName: true } } },
        }),
        prisma.outreachDraft.findMany({
            where: { userId, archived: false, sentAt: null },
            orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
            take: 8,
            include: { contact: { select: { id: true, displayName: true } } },
        }),
    ]);

    const reachOut = contacts
        .filter((contact) => {
            if (!contact.stayInTouch) return false;
            if (!contact.lastContactAt) return true;
            const cadence = contact.stayInTouchDays ?? 30;
            return now.getTime() - contact.lastContactAt.getTime() >= cadence * 86_400_000;
        })
        .sort((a, b) => (a.lastContactAt?.getTime() ?? 0) - (b.lastContactAt?.getTime() ?? 0))
        .slice(0, 8)
        .map(contactSummary);

    const upcoming = [
        ...contacts
            .filter((contact) => contact.birthday)
            .map((contact) => ({
                id: `birthday:${contact.id}`,
                contactId: contact.id,
                name: contact.displayName,
                kind: "Birthday",
                date: isoDay(contact.birthday!),
                days: daysUntilAnnual(contact.birthday!),
            })),
        ...contactDates.map((entry) => ({
            id: entry.id,
            contactId: entry.contact.id,
            name: entry.contact.displayName,
            kind: entry.dateType,
            date: isoDay(entry.dateValue),
            days: daysUntilAnnual(entry.dateValue),
        })),
    ]
        .filter((entry) => entry.days <= 60)
        .sort((a, b) => a.days - b.days)
        .slice(0, 10);

    return {
        stats: {
            contacts: contacts.length,
            innerCircle: contacts.filter((contact) => contact.innerCircle).length,
            events: eventCount,
            remindersDue: dueReminders,
        },
        innerCircle: contacts.filter((contact) => contact.innerCircle).slice(0, 12).map(contactSummary),
        reachOut,
        recentInteractions: interactions.map((entry) => ({
            id: entry.id,
            contactId: entry.contact.id,
            contactName: entry.contact.displayName,
            interactionType: entry.interactionType,
            date: entry.date.toISOString(),
            notes: entry.notes,
        })),
        upcoming,
        drafts: drafts.map((draft) => ({
            id: draft.id,
            contactId: draft.contact?.id ?? null,
            contactName: draft.contact?.displayName ?? null,
            channel: draft.channel,
            body: draft.body,
            dueAt: iso(draft.dueAt),
            createdAt: draft.createdAt.toISOString(),
        })),
        battery: battery.map((entry) => ({ id: entry.id, date: isoDay(entry.date), energyLevel: entry.energyLevel, notes: entry.notes })),
    };
}

export async function getContactsNew(userId: string) {
    const tags = await prisma.socialTag.findMany({ where: { userId }, orderBy: { name: "asc" } });
    return { tags };
}

export async function getContacts(userId: string) {
    const [contacts, tags] = await Promise.all([
        prisma.socialContact.findMany({
            where: { userId },
            orderBy: [{ active: "desc" }, { displayName: "asc" }],
            include: {
                emails: true,
                phones: true,
                handles: true,
                tags: { select: { id: true, name: true, color: true } },
                reminders: { where: { completed: false }, orderBy: { scheduledFor: "asc" }, take: 1 },
                _count: { select: { interactions: true, memories: true } },
            },
        }),
        prisma.socialTag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    ]);

    return {
        contacts: contacts.map((contact) => ({
            ...contactSummary(contact),
            firstName: contact.firstName,
            lastName: contact.lastName,
            nickname: contact.nickname,
            preferredContactMethod: contact.preferredContactMethod,
            status: contact.status,
            emails: contact.emails,
            phones: contact.phones,
            handles: contact.handles,
            tags: contact.tags,
            nextReminderAt: iso(contact.reminders[0]?.scheduledFor),
            interactionCount: contact._count.interactions,
            memoryCount: contact._count.memories,
        })),
        tags,
    };
}

export async function getCalendar(userId: string) {
    const [events, contacts, dates] = await Promise.all([
        prisma.socialEvent.findMany({ where: { userId }, orderBy: [{ eventDate: "asc" }, { createdAt: "desc" }] }),
        prisma.socialContact.findMany({ where: { userId, active: true, birthday: { not: null } }, select: { id: true, displayName: true, birthday: true } }),
        prisma.contactDate.findMany({ where: { contact: { userId, active: true } }, include: { contact: { select: { id: true, displayName: true } } } }),
    ]);
    return {
        events: events.map((event) => ({
            ...event,
            coverImageUrl: resolveAssetUrl(event.coverImageKey),
            eventDate: iso(event.eventDate),
            createdAt: event.createdAt.toISOString(),
            updatedAt: event.updatedAt.toISOString(),
        })),
        annualDates: [
            ...contacts.map((contact) => ({ id: `birthday:${contact.id}`, contactId: contact.id, contactName: contact.displayName, kind: "Birthday", date: isoDay(contact.birthday!) })),
            ...dates.map((entry) => ({ id: entry.id, contactId: entry.contact.id, contactName: entry.contact.displayName, kind: entry.dateType, date: isoDay(entry.dateValue) })),
        ],
    };
}

export async function getDrafts(userId: string) {
    const [drafts, contacts] = await Promise.all([
        prisma.outreachDraft.findMany({
            where: { userId },
            orderBy: [{ archived: "asc" }, { dueAt: "asc" }, { updatedAt: "desc" }],
            include: { contact: { select: { id: true, displayName: true } } },
        }),
        prisma.socialContact.findMany({
            where: { userId, active: true },
            orderBy: { displayName: "asc" },
            select: { id: true, displayName: true },
        }),
    ]);
    return {
        drafts: drafts.map((draft) => ({
            ...draft,
            contactName: draft.contact?.displayName ?? null,
            dueAt: iso(draft.dueAt),
            sentAt: iso(draft.sentAt),
            createdAt: draft.createdAt.toISOString(),
            updatedAt: draft.updatedAt.toISOString(),
        })),
        contacts,
    };
}

export async function getEvents(userId: string) {
    const events = await prisma.socialEvent.findMany({ where: { userId }, orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }] });
    return {
        events: events.map((event) => ({
            ...event,
            coverImageUrl: resolveAssetUrl(event.coverImageKey),
            eventDate: iso(event.eventDate),
            createdAt: event.createdAt.toISOString(),
            updatedAt: event.updatedAt.toISOString(),
        })),
    };
}

export async function getTags(userId: string) {
    const tags = await prisma.socialTag.findMany({ where: { userId }, orderBy: { name: "asc" }, include: { _count: { select: { contacts: true } } } });
    return { tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, contactCount: tag._count.contacts })) };
}

function requiredText(payload: Record<string, unknown>, key: string, label: string, maxLength = 4_000): string {
    const value = typeof payload[key] === "string" ? payload[key].trim() : "";
    if (!value) throw new Error(`${label} is required.`);
    if (value.length > maxLength) throw new Error(`${label} must be ${maxLength.toLocaleString()} characters or fewer.`);
    return value;
}

function optionalText(payload: Record<string, unknown>, key: string, maxLength = 4_000): string | null {
    const value = typeof payload[key] === "string" ? payload[key].trim() : "";
    if (!value) return null;
    if (value.length > maxLength) throw new Error(`${key} must be ${maxLength.toLocaleString()} characters or fewer.`);
    return value;
}

function requiredId(payload: Record<string, unknown>, key: string): string {
    return requiredText(payload, key, "Record id", 200);
}

function optionalDate(payload: Record<string, unknown>, key: string): Date | null {
    const raw = optionalText(payload, key, 100);
    if (!raw) return null;
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) throw new Error(`${key} must be a valid date.`);
    return value;
}

function optionalInteger(payload: Record<string, unknown>, key: string, minimum: number, maximum: number): number | null {
    const raw = payload[key];
    if (raw === null || raw === undefined || raw === "") return null;
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${key} must be a whole number from ${minimum} to ${maximum}.`);
    }
    return value;
}

function stringList(payload: Record<string, unknown>, key: string): string[] {
    const raw = payload[key];
    const values = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
            ? raw.split(/[\n,]/)
            : [];
    return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

async function assertOwnedContact(userId: string, contactId: string): Promise<void> {
    const contact = await prisma.socialContact.findFirst({ where: { id: contactId, userId }, select: { id: true } });
    if (!contact) throw new Error("Contact not found.");
}

async function validateTagIds(userId: string, tagIds: string[]): Promise<string[]> {
    if (tagIds.length === 0) return [];
    const ownedTags = await prisma.socialTag.findMany({ where: { userId, id: { in: tagIds } }, select: { id: true } });
    if (ownedTags.length !== tagIds.length) throw new Error("One or more tags were not found.");
    return ownedTags.map((tag) => tag.id);
}

/** Create a local contact with the fields used by the native directory. */
export async function createContact(userId: string, payload: Record<string, unknown> = {}) {
    const displayName = requiredText(payload, "displayName", "Display name", 200);
    const emails = stringList(payload, "emails");
    const phones = stringList(payload, "phones");
    const fallbackEmail = optionalText(payload, "email", 320);
    const fallbackPhone = optionalText(payload, "phone", 100);
    if (emails.length === 0 && fallbackEmail) emails.push(fallbackEmail);
    if (phones.length === 0 && fallbackPhone) phones.push(fallbackPhone);
    const handles = stringList(payload, "handles").map((value) => {
        const separator = value.includes(":") ? value.indexOf(":") : value.indexOf("=");
        return separator > 0
            ? { platform: value.slice(0, separator).trim(), handle: value.slice(separator + 1).trim() }
            : { platform: "Social", handle: value.trim() };
    }).filter((item) => item.platform && item.handle);
    const currentCity = optionalText(payload, "currentCity", 200);
    const anniversary = optionalDate(payload, "anniversary");
    const tagIds = await validateTagIds(userId, stringList(payload, "tagIds"));
    const stayInTouch = payload.stayInTouch === true;

    const contact = await prisma.socialContact.create({
        data: {
            userId,
            displayName,
            relationshipType: optionalText(payload, "relationshipType", 100),
            howWeMet: optionalText(payload, "howWeMet", 1_000),
            occupation: optionalText(payload, "occupation", 200),
            companyOrSchool: optionalText(payload, "companyOrSchool", 200),
            timezone: optionalText(payload, "timezone", 100),
            interests: optionalText(payload, "interests", 4_000),
            birthday: optionalDate(payload, "birthday"),
            notes: optionalText(payload, "notes", 8_000),
            innerCircle: payload.innerCircle === true,
            stayInTouch,
            stayInTouchDays: stayInTouch ? optionalInteger(payload, "stayInTouchDays", 1, 3_650) ?? 30 : null,
            preferredContactMethod: optionalText(payload, "preferredContactMethod", 100),
            emails: emails.length ? { create: emails.map((email, index) => ({ email: email.slice(0, 320), label: "Other", isPrimary: index === 0 })) } : undefined,
            phones: phones.length ? { create: phones.map((phone, index) => ({ phone: phone.slice(0, 100), label: "Mobile", isPrimary: index === 0 })) } : undefined,
            handles: handles.length ? { create: handles.map(({ platform, handle }) => ({ platform: platform.slice(0, 100), handle: handle.slice(0, 320) })) } : undefined,
            addresses: currentCity ? { create: { addressType: "Current", city: currentCity } } : undefined,
            dates: anniversary ? { create: { dateType: "Anniversary", dateValue: anniversary } } : undefined,
            tags: tagIds.length ? { connect: tagIds.map((id) => ({ id })) } : undefined,
        },
        select: { id: true },
    });
    return { ok: true, id: contact.id };
}

/** Delete only a contact owned by the resolved local user. */
export async function deleteContact(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredId(payload, "id");
    const deleted = await prisma.socialContact.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw new Error("Contact not found.");
    return { ok: true, id };
}

export async function createEvent(userId: string, payload: Record<string, unknown> = {}) {
    const event = await prisma.socialEvent.create({
        data: {
            userId,
            name: requiredText(payload, "name", "Event name", 200),
            eventDate: optionalDate(payload, "eventDate"),
            location: optionalText(payload, "location", 500),
            attendees: stringList(payload, "attendees"),
            notes: optionalText(payload, "notes", 8_000),
        },
        select: { id: true },
    });
    return { ok: true, id: event.id };
}

export async function deleteEvent(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredId(payload, "id");
    const deleted = await prisma.socialEvent.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw new Error("Event not found.");
    return { ok: true, id };
}

async function draftContactId(userId: string, payload: Record<string, unknown>): Promise<string | null> {
    const contactId = optionalText(payload, "contactId", 200);
    if (contactId) await assertOwnedContact(userId, contactId);
    return contactId;
}

export async function createDraft(userId: string, payload: Record<string, unknown> = {}) {
    const draft = await prisma.outreachDraft.create({
        data: {
            userId,
            contactId: await draftContactId(userId, payload),
            channel: optionalText(payload, "channel", 100),
            body: requiredText(payload, "body", "Message body", 20_000),
            dueAt: optionalDate(payload, "dueAt"),
        },
        select: { id: true },
    });
    return { ok: true, id: draft.id };
}

/** Generate a local outreach draft while imitating an optional user-provided writing sample. */
export async function assistDraft(userId: string, payload: Record<string, unknown> = {}) {
    const brief = requiredText(payload, "brief", "What the message should say", 8_000);
    const channel = optionalText(payload, "channel", 100) ?? "text";
    const styleSample = optionalText(payload, "styleSample", 12_000);
    const contactId = optionalText(payload, "contactId", 200);
    let contactName = "the recipient";
    if (contactId) {
        const contact = await prisma.socialContact.findFirst({ where: { id: contactId, userId }, select: { displayName: true } });
        if (!contact) throw new Error("Contact not found.");
        contactName = contact.displayName;
    }
    const ai = await ollamaJson<{ body?: string }>(
        `Write a ${channel} message to ${contactName}. Return {"body":"..."}. Preserve the user's natural voice, level of formality, punctuation, sentence length, and emoji habits from the sample without copying its subject matter. Do not invent facts.\n\nMessage goal:\n${brief}\n\nWriting sample:\n${styleSample || "No sample provided; write warmly and concisely."}`,
        12_000,
    );
    const body = typeof ai?.value.body === "string" && ai.value.body.trim() ? ai.value.body.trim().slice(0, 20_000) : brief;
    return { body, aiUsed: Boolean(ai), model: ai?.model ?? null };
}

export async function updateDraft(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredId(payload, "id");
    const existing = await prisma.outreachDraft.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw new Error("Draft not found.");
    await prisma.outreachDraft.update({
        where: { id },
        data: {
            contactId: await draftContactId(userId, payload),
            channel: optionalText(payload, "channel", 100),
            body: requiredText(payload, "body", "Message body", 20_000),
            dueAt: optionalDate(payload, "dueAt"),
        },
    });
    return { ok: true, id };
}

export async function deleteDraft(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredId(payload, "id");
    const deleted = await prisma.outreachDraft.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw new Error("Draft not found.");
    return { ok: true, id };
}

/** One battery entry per calendar day, matching the original LifeOS upsert semantics. */
export async function logBattery(userId: string, payload: Record<string, unknown> = {}) {
    const energyLevel = optionalInteger(payload, "energyLevel", 1, 10);
    if (energyLevel === null) throw new Error("Energy level is required.");
    const rawDate = optionalText(payload, "date", 100) ?? localDateKey();
    const date = new Date(`${rawDate.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new Error("Date must be valid.");
    const row = await prisma.socialBattery.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, energyLevel, notes: optionalText(payload, "notes", 2_000) },
        update: { energyLevel, notes: optionalText(payload, "notes", 2_000) },
        select: { id: true },
    });
    return { ok: true, id: row.id, date: isoDay(date), energyLevel };
}

export async function createTag(userId: string, payload: Record<string, unknown> = {}) {
    const name = requiredText(payload, "name", "Tag name", 80);
    const existing = await prisma.socialTag.findUnique({ where: { userId_name: { userId, name } }, select: { id: true, name: true, color: true } });
    if (existing) return { ok: true, ...existing };
    const tag = await prisma.socialTag.create({
        data: { userId, name, color: optionalText(payload, "color", 50) },
        select: { id: true, name: true, color: true },
    });
    return { ok: true, ...tag };
}

export async function deleteTag(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredId(payload, "id");
    const deleted = await prisma.socialTag.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw new Error("Tag not found.");
    return { ok: true, id };
}
