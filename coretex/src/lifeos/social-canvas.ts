import { prisma } from "../db/prisma.js";
import { resolveAssetUrl } from "./assets.js";

const DAY_MS = 86_400_000;
const GIFT_STAGES = new Set(["idea", "purchased", "wrapped", "delivered"]);

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const isoDay = (value: Date) => value.toISOString().slice(0, 10);

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

function optionalDate(payload: Record<string, unknown>, key: string): Date | null {
    const raw = optionalText(payload, key, 100);
    if (!raw) return null;
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) throw new Error(`${key} must be a valid date.`);
    return value;
}

async function ownedContact(userId: string, contactId: string) {
    const contact = await prisma.socialContact.findFirst({
        where: { id: contactId, userId },
        select: { id: true, lastContactAt: true },
    });
    if (!contact) throw new Error("Contact not found.");
    return contact;
}

function defaultCadence(relationshipType: string | null, innerCircle: boolean): number {
    const relationship = relationshipType?.toLowerCase() ?? "";
    if (innerCircle) return 14;
    if (relationship.includes("family") || relationship.includes("parent") || relationship.includes("sibling")) return 14;
    if (relationship.includes("close") || relationship.includes("partner") || relationship.includes("spouse")) return 21;
    if (relationship.includes("friend")) return 30;
    if (relationship.includes("colleague") || relationship.includes("mentor")) return 45;
    return 60;
}

function relationshipTier(relationshipType: string | null, innerCircle: boolean): string {
    const relationship = relationshipType?.toLowerCase() ?? "";
    if (innerCircle) return "Inner circle";
    if (relationship.includes("family") || relationship.includes("parent") || relationship.includes("sibling")) return "Family";
    if (relationship.includes("close") || relationship.includes("partner") || relationship.includes("spouse")) return "Close friend";
    if (relationship.includes("friend")) return "Friend";
    return relationshipType?.trim() || "Community";
}

function relationshipHealth(daysSince: number | null, cadenceDays: number) {
    if (daysSince === null) return { score: 62, status: "due" as const, progress: 1 };
    const progress = daysSince / Math.max(1, cadenceDays);
    const score = progress <= 0.5
        ? Math.round(100 - progress * 10)
        : progress <= 1
            ? Math.round(95 - (progress - 0.5) * 30)
            : Math.max(8, Math.round(80 - (progress - 1) * 55));
    return {
        score,
        status: progress < 0.8 ? "healthy" as const : progress <= 1.1 ? "due" as const : "overdue" as const,
        progress,
    };
}

function nextAnnualOccurrence(value: Date, now: Date): Date {
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12));
    if (candidate.getTime() < now.getTime()) candidate.setUTCFullYear(candidate.getUTCFullYear() + 1);
    return candidate;
}

function giftStage(direction: string | null, givenDate: Date | null): string {
    const normalized = direction?.toLowerCase() ?? "";
    if (GIFT_STAGES.has(normalized)) return normalized;
    if (givenDate && givenDate.getTime() <= Date.now()) return "delivered";
    return "idea";
}

/**
 * One payload powers the topology, health dashboard, profile inspector, gift
 * pipeline, and event command center. Keeping the query centralized makes the
 * canvas feel immediate while still using the local Life OS database as truth.
 */
export async function getCanvas(userId: string) {
    const now = new Date();
    const activityStart = new Date(now.getTime() - 83 * DAY_MS);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [contacts, connections, events, activityInteractions, drafts] = await Promise.all([
        prisma.socialContact.findMany({
            where: { userId, active: true },
            orderBy: [{ innerCircle: "desc" }, { displayName: "asc" }],
            include: {
                emails: { orderBy: { isPrimary: "desc" } },
                phones: { orderBy: { isPrimary: "desc" } },
                handles: true,
                addresses: true,
                dates: true,
                tags: { select: { id: true, name: true, color: true } },
                contactNotes: { orderBy: { createdAt: "desc" }, take: 8 },
                reminders: { where: { completed: false }, orderBy: { scheduledFor: "asc" }, take: 5 },
                interactions: { orderBy: { date: "desc" }, take: 12 },
                communications: { orderBy: { date: "desc" }, take: 8 },
                eventAttendees: {
                    select: {
                        id: true,
                        rsvp: true,
                        event: { select: { id: true, title: true, description: true, location: true, startsAt: true } },
                    },
                    take: 8,
                },
                memories: { orderBy: [{ memoryDate: "desc" }, { createdAt: "desc" }], take: 6 },
                gifts: { orderBy: [{ givenDate: "desc" }, { createdAt: "desc" }] },
                _count: { select: { interactions: true, memories: true, gifts: true } },
            },
        }),
        prisma.socialConnection.findMany({
            where: { OR: [{ contact1: { userId } }, { contact2: { userId } }] },
            select: { id: true, contact1Id: true, contact2Id: true, relationshipType: true, notes: true },
        }),
        prisma.socialEvent.findMany({
            where: { userId },
            orderBy: [{ eventDate: "asc" }, { createdAt: "desc" }],
            take: 40,
        }),
        prisma.socialInteraction.findMany({
            where: { contact: { userId }, date: { gte: previousMonthStart } },
            orderBy: { date: "asc" },
            select: { id: true, contactId: true, interactionType: true, date: true },
        }),
        prisma.outreachDraft.findMany({
            where: { userId, archived: false, sentAt: null },
            orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
            include: { contact: { select: { id: true, displayName: true } } },
            take: 12,
        }),
    ]);

    const mappedContacts = contacts.map((contact) => {
        const latestInteraction = contact.interactions[0]?.date ?? contact.communications[0]?.date ?? null;
        const lastContactAt = !contact.lastContactAt || (latestInteraction && latestInteraction > contact.lastContactAt)
            ? latestInteraction
            : contact.lastContactAt;
        const daysSince = lastContactAt ? Math.max(0, Math.floor((now.getTime() - lastContactAt.getTime()) / DAY_MS)) : null;
        const cadenceDays = contact.stayInTouchDays ?? defaultCadence(contact.relationshipType, contact.innerCircle);
        const health = relationshipHealth(daysSince, cadenceDays);
        const nextDueAt = lastContactAt
            ? new Date(lastContactAt.getTime() + cadenceDays * DAY_MS)
            : now;
        const milestones = [
            ...(contact.birthday ? [{ id: `birthday:${contact.id}`, kind: "Birthday", date: nextAnnualOccurrence(contact.birthday, now) }] : []),
            ...contact.dates.map((date) => ({ id: date.id, kind: date.dateType, date: nextAnnualOccurrence(date.dateValue, now) })),
        ].sort((a, b) => a.date.getTime() - b.date.getTime());

        return {
            id: contact.id,
            displayName: contact.displayName,
            firstName: contact.firstName,
            lastName: contact.lastName,
            nickname: contact.nickname,
            avatarKey: contact.avatarKey,
            avatarUrl: resolveAssetUrl(contact.avatarKey),
            relationshipType: contact.relationshipType,
            tier: relationshipTier(contact.relationshipType, contact.innerCircle),
            howWeMet: contact.howWeMet,
            birthday: iso(contact.birthday),
            occupation: contact.occupation,
            companyOrSchool: contact.companyOrSchool,
            hometown: contact.hometown,
            timezone: contact.timezone,
            pronouns: contact.pronouns,
            status: contact.status,
            interests: contact.interests,
            notes: contact.notes,
            closenessScore: contact.closenessScore,
            trustScore: contact.trustScore,
            communicationFrequency: contact.communicationFrequency,
            energyTags: contact.energyTags,
            innerCircle: contact.innerCircle,
            stayInTouch: contact.stayInTouch,
            cadenceDays,
            preferredContactMethod: contact.preferredContactMethod,
            lastContactAt: iso(lastContactAt),
            daysSince,
            nextDueAt: nextDueAt.toISOString(),
            healthScore: health.score,
            healthStatus: health.status,
            cadenceProgress: health.progress,
            emails: contact.emails,
            phones: contact.phones,
            handles: contact.handles,
            addresses: contact.addresses,
            tags: contact.tags,
            profileNotes: contact.contactNotes.map((note) => ({ ...note, createdAt: note.createdAt.toISOString() })),
            reminders: contact.reminders.map((reminder) => ({ ...reminder, scheduledFor: reminder.scheduledFor.toISOString(), createdAt: reminder.createdAt.toISOString() })),
            timeline: [
                ...contact.interactions.map((entry) => ({ id: entry.id, kind: "interaction", type: entry.interactionType, date: entry.date.toISOString(), notes: entry.notes })),
                ...contact.communications.map((entry) => ({ id: entry.id, kind: "communication", type: entry.channel, date: entry.date.toISOString(), notes: entry.notes, sentiment: entry.sentiment })),
                ...contact.eventAttendees.map((entry) => ({
                    id: `calendar:${entry.event.id}:${entry.id}`,
                    kind: "calendar",
                    type: entry.event.title,
                    date: entry.event.startsAt.toISOString(),
                    notes: [entry.event.location, entry.event.description].filter(Boolean).join(" · ") || null,
                    sentiment: entry.rsvp.toLowerCase(),
                })),
            ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14),
            memories: contact.memories.map((memory) => ({ id: memory.id, title: memory.title, description: memory.description, memoryDate: iso(memory.memoryDate), location: memory.location })),
            gifts: contact.gifts.map((gift) => ({
                id: gift.id,
                description: gift.giftDescription,
                occasion: gift.occasion,
                givenDate: iso(gift.givenDate),
                direction: gift.direction,
                stage: giftStage(gift.direction, gift.givenDate),
                createdAt: gift.createdAt.toISOString(),
            })),
            milestones: milestones.map((milestone) => ({ id: milestone.id, kind: milestone.kind, date: milestone.date.toISOString(), days: Math.ceil((milestone.date.getTime() - now.getTime()) / DAY_MS) })),
            counts: contact._count,
        };
    });

    const contactById = new Map(mappedContacts.map((contact) => [contact.id, contact]));
    const validConnections = connections.filter((connection) => contactById.has(connection.contact1Id) && contactById.has(connection.contact2Id));
    const currentMonthInteractions = activityInteractions.filter((entry) => entry.date >= monthStart).length;
    const previousMonthInteractions = activityInteractions.filter((entry) => entry.date < monthStart).length;
    const monthlyTarget = mappedContacts.reduce((sum, contact) => sum + Math.max(1, Math.round(30 / contact.cadenceDays)), 0);

    const activityByDay = new Map<string, number>();
    for (const entry of activityInteractions) {
        if (entry.date < activityStart) continue;
        const key = isoDay(entry.date);
        activityByDay.set(key, (activityByDay.get(key) ?? 0) + 1);
    }
    const activity = Array.from({ length: 84 }, (_, index) => {
        const date = new Date(activityStart.getTime() + index * DAY_MS);
        const count = activityByDay.get(isoDay(date)) ?? 0;
        return { date: isoDay(date), count, level: count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4 };
    });

    const gifts = mappedContacts.flatMap((contact) => contact.gifts.map((gift) => ({ ...gift, contactId: contact.id, contactName: contact.displayName })));
    const upcomingMilestones = mappedContacts
        .flatMap((contact) => contact.milestones.map((milestone) => ({ ...milestone, contactId: contact.id, contactName: contact.displayName })))
        .filter((milestone) => milestone.days <= 45)
        .sort((a, b) => a.days - b.days);
    const healthScore = mappedContacts.length
        ? Math.round(mappedContacts.reduce((sum, contact) => sum + contact.healthScore, 0) / mappedContacts.length)
        : 100;

    return {
        generatedAt: now.toISOString(),
        metrics: {
            healthScore,
            healthy: mappedContacts.filter((contact) => contact.healthStatus === "healthy").length,
            due: mappedContacts.filter((contact) => contact.healthStatus === "due").length,
            overdue: mappedContacts.filter((contact) => contact.healthStatus === "overdue").length,
            currentMonthInteractions,
            previousMonthInteractions,
            monthlyTarget,
            socialBudgetPercent: monthlyTarget ? Math.min(100, Math.round((currentMonthInteractions / monthlyTarget) * 100)) : 100,
            momentum: previousMonthInteractions ? Math.round(((currentMonthInteractions - previousMonthInteractions) / previousMonthInteractions) * 100) : currentMonthInteractions ? 100 : 0,
            plannedEvents: events.filter((event) => event.eventDate && event.eventDate >= now).length,
        },
        contacts: mappedContacts,
        connections: validConnections.map((connection) => ({
            ...connection,
            strength: Math.max(1, Math.round(((contactById.get(connection.contact1Id)?.healthScore ?? 50) + (contactById.get(connection.contact2Id)?.healthScore ?? 50)) / 40)),
        })),
        activity,
        gifts,
        upcomingMilestones,
        events: events.map((event) => ({
            id: event.id,
            name: event.name,
            eventDate: iso(event.eventDate),
            location: event.location,
            attendees: Array.isArray(event.attendees) ? event.attendees.filter((value): value is string => typeof value === "string") : [],
            notes: event.notes,
            coverImageKey: event.coverImageKey,
            coverImageUrl: resolveAssetUrl(event.coverImageKey),
        })),
        drafts: drafts.map((draft) => ({
            id: draft.id,
            contactId: draft.contactId,
            contactName: draft.contact?.displayName ?? null,
            channel: draft.channel,
            body: draft.body,
            dueAt: iso(draft.dueAt),
        })),
        integrations: [
            { id: "email", label: "Email timeline", status: "available", detail: "Email adapters can match messages to primary addresses through the ingestion API." },
            { id: "calendar", label: "Calendar context", status: "available", detail: "Linked calendar attendees appear automatically in each relationship timeline." },
            { id: "webhooks", label: "Social signals", status: "available", detail: "API-ready ingestion hook for public life updates and connector events." },
        ],
    };
}

export async function logInteraction(userId: string, payload: Record<string, unknown> = {}) {
    const contactId = requiredText(payload, "contactId", "Contact", 200);
    const contact = await ownedContact(userId, contactId);
    const date = optionalDate(payload, "date") ?? new Date();
    const interactionType = optionalText(payload, "interactionType", 100) ?? "catch-up";
    const notes = optionalText(payload, "notes", 8_000);

    const result = await prisma.$transaction(async (tx) => {
        const interaction = await tx.socialInteraction.create({
            data: { contactId, date, interactionType, notes },
            select: { id: true },
        });
        if (!contact.lastContactAt || date > contact.lastContactAt) {
            await tx.socialContact.update({ where: { id: contactId }, data: { lastContactAt: date } });
        }
        return interaction;
    });
    return { ok: true, id: result.id, date: date.toISOString() };
}

/**
 * Connector/webhook entry point for Gmail, calendar, and social adapters.
 * A caller may provide contactId directly or an email address to resolve the
 * relationship. Exact duplicate deliveries are ignored so webhook retries are
 * safe, and every accepted event refreshes the contact cadence clock.
 */
export async function ingestCommunication(userId: string, payload: Record<string, unknown> = {}) {
    let contactId = optionalText(payload, "contactId", 200);
    if (!contactId) {
        const email = requiredText(payload, "email", "Contact email", 320).toLowerCase();
        const candidates = await prisma.socialContact.findMany({
            where: { userId, active: true, emails: { some: {} } },
            select: { id: true, emails: { select: { email: true } } },
        });
        contactId = candidates.find((contact) => contact.emails.some((entry) => entry.email.toLowerCase() === email))?.id ?? null;
        if (!contactId) throw new Error("No contact matches that email address.");
    }
    const contact = await ownedContact(userId, contactId);
    const channel = optionalText(payload, "channel", 100) ?? "connector";
    const date = optionalDate(payload, "date") ?? new Date();
    const notes = optionalText(payload, "notes", 8_000);
    const sentiment = optionalText(payload, "sentiment", 100);

    const duplicate = await prisma.communicationLog.findFirst({
        where: { contactId, channel, date, notes },
        select: { id: true },
    });
    if (duplicate) return { ok: true, id: duplicate.id, duplicate: true, contactId };

    const row = await prisma.$transaction(async (tx) => {
        const created = await tx.communicationLog.create({
            data: { contactId: contactId!, channel, date, notes, sentiment },
            select: { id: true },
        });
        if (!contact.lastContactAt || date > contact.lastContactAt) {
            await tx.socialContact.update({ where: { id: contactId! }, data: { lastContactAt: date } });
        }
        return created;
    });
    return { ok: true, id: row.id, duplicate: false, contactId };
}

export async function createReminder(userId: string, payload: Record<string, unknown> = {}) {
    const contactId = requiredText(payload, "contactId", "Contact", 200);
    await ownedContact(userId, contactId);
    const scheduledFor = optionalDate(payload, "scheduledFor");
    if (!scheduledFor) throw new Error("Reminder date is required.");
    const reminder = await prisma.contactReminder.create({
        data: {
            contactId,
            scheduledFor,
            reminderType: optionalText(payload, "reminderType", 200) ?? "Reach out",
        },
        select: { id: true },
    });
    return { ok: true, id: reminder.id };
}

export async function completeReminder(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredText(payload, "id", "Reminder", 200);
    const reminder = await prisma.contactReminder.findFirst({ where: { id, contact: { userId } }, select: { id: true } });
    if (!reminder) throw new Error("Reminder not found.");
    await prisma.contactReminder.update({ where: { id }, data: { completed: true } });
    return { ok: true, id };
}

export async function createGift(userId: string, payload: Record<string, unknown> = {}) {
    const contactId = requiredText(payload, "contactId", "Contact", 200);
    await ownedContact(userId, contactId);
    const requestedStage = optionalText(payload, "stage", 40)?.toLowerCase() ?? "idea";
    const stage = GIFT_STAGES.has(requestedStage) ? requestedStage : "idea";
    const gift = await prisma.socialGift.create({
        data: {
            contactId,
            giftDescription: requiredText(payload, "description", "Gift idea", 1_000),
            occasion: optionalText(payload, "occasion", 200),
            direction: stage,
            givenDate: stage === "delivered" ? optionalDate(payload, "givenDate") ?? new Date() : optionalDate(payload, "givenDate"),
        },
        select: { id: true },
    });
    return { ok: true, id: gift.id, stage };
}

export async function updateGiftStage(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredText(payload, "id", "Gift", 200);
    const stage = requiredText(payload, "stage", "Gift stage", 40).toLowerCase();
    if (!GIFT_STAGES.has(stage)) throw new Error("Gift stage is not supported.");
    const gift = await prisma.socialGift.findFirst({ where: { id, contact: { userId } }, select: { id: true, givenDate: true } });
    if (!gift) throw new Error("Gift not found.");
    await prisma.socialGift.update({
        where: { id },
        data: { direction: stage, givenDate: stage === "delivered" ? gift.givenDate ?? new Date() : gift.givenDate },
    });
    return { ok: true, id, stage };
}

export async function createMemory(userId: string, payload: Record<string, unknown> = {}) {
    const contactId = requiredText(payload, "contactId", "Contact", 200);
    await ownedContact(userId, contactId);
    const memory = await prisma.socialMemory.create({
        data: {
            contactId,
            title: optionalText(payload, "title", 240),
            description: requiredText(payload, "description", "Memory", 8_000),
            memoryDate: optionalDate(payload, "memoryDate"),
            location: optionalText(payload, "location", 500),
        },
        select: { id: true },
    });
    return { ok: true, id: memory.id };
}

/** Generate editable outreach drafts for the contacts named on an event. */
export async function draftEventInvites(userId: string, payload: Record<string, unknown> = {}) {
    const eventId = requiredText(payload, "eventId", "Event", 200);
    const event = await prisma.socialEvent.findFirst({
        where: { id: eventId, userId },
        select: { id: true, name: true, eventDate: true, location: true, attendees: true },
    });
    if (!event) throw new Error("Event not found.");
    const attendeeNames = Array.isArray(event.attendees)
        ? event.attendees.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
        : [];
    if (attendeeNames.length === 0) throw new Error("Add attendees before drafting invitations.");

    const contacts = await prisma.socialContact.findMany({
        where: { userId, active: true },
        select: { id: true, displayName: true, preferredContactMethod: true },
    });
    const byName = new Map(contacts.map((contact) => [contact.displayName.trim().toLowerCase(), contact]));
    const when = event.eventDate
        ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(event.eventDate)
        : "soon";
    const where = event.location ? ` at ${event.location}` : "";
    let created = 0;
    for (const attendeeName of attendeeNames) {
        const contact = byName.get(attendeeName.toLowerCase());
        if (!contact) continue;
        const body = `Hey ${contact.displayName.split(/\s+/)[0]}, I’m planning ${event.name} for ${when}${where}. Would you like to join?`;
        const duplicate = await prisma.outreachDraft.findFirst({
            where: { userId, contactId: contact.id, body, archived: false, sentAt: null },
            select: { id: true },
        });
        if (duplicate) continue;
        await prisma.outreachDraft.create({
            data: {
                userId,
                contactId: contact.id,
                channel: contact.preferredContactMethod ?? "text",
                body,
                dueAt: event.eventDate ? new Date(Math.max(Date.now(), event.eventDate.getTime() - 14 * DAY_MS)) : null,
            },
        });
        created++;
    }
    if (created === 0) throw new Error("No attendee names matched active contacts, or their invitations already exist.");
    return { ok: true, eventId, created };
}

export async function createConnection(userId: string, payload: Record<string, unknown> = {}) {
    const contact1Id = requiredText(payload, "contact1Id", "First contact", 200);
    const contact2Id = requiredText(payload, "contact2Id", "Second contact", 200);
    if (contact1Id === contact2Id) throw new Error("Choose two different contacts.");
    await Promise.all([ownedContact(userId, contact1Id), ownedContact(userId, contact2Id)]);
    const existing = await prisma.socialConnection.findFirst({
        where: {
            OR: [
                { contact1Id, contact2Id },
                { contact1Id: contact2Id, contact2Id: contact1Id },
            ],
        },
        select: { id: true },
    });
    if (existing) {
        // Allow updating relationship metadata when re-linking the same pair.
        const relationshipType = optionalText(payload, "relationshipType", 200);
        const notes = optionalText(payload, "notes", 2_000);
        if (relationshipType !== null || notes !== null) {
            await prisma.socialConnection.update({
                where: { id: existing.id },
                data: {
                    ...(relationshipType !== null ? { relationshipType } : {}),
                    ...(notes !== null ? { notes } : {}),
                },
            });
        }
        return { ok: true, id: existing.id };
    }
    const connection = await prisma.socialConnection.create({
        data: {
            contact1Id,
            contact2Id,
            relationshipType: optionalText(payload, "relationshipType", 200),
            notes: optionalText(payload, "notes", 2_000),
        },
        select: { id: true },
    });
    return { ok: true, id: connection.id };
}

export async function deleteConnection(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredText(payload, "id", "Connection", 200);
    const row = await prisma.socialConnection.findFirst({
        where: {
            id,
            OR: [{ contact1: { userId } }, { contact2: { userId } }],
        },
        select: { id: true },
    });
    if (!row) throw new Error("Connection not found.");
    await prisma.socialConnection.delete({ where: { id } });
    return { ok: true, id };
}

export async function createHandle(userId: string, payload: Record<string, unknown> = {}) {
    const contactId = requiredText(payload, "contactId", "Contact", 200);
    await ownedContact(userId, contactId);
    const platform = requiredText(payload, "platform", "Platform", 80);
    const handle = requiredText(payload, "handle", "Handle", 320);
    const row = await prisma.contactHandle.create({
        data: { contactId, platform, handle },
        select: { id: true, platform: true, handle: true, contactId: true },
    });
    return { ok: true, ...row };
}

export async function updateHandle(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredText(payload, "id", "Handle", 200);
    const row = await prisma.contactHandle.findFirst({
        where: { id, contact: { userId } },
        select: { id: true, contactId: true },
    });
    if (!row) throw new Error("Handle not found.");
    const platform = requiredText(payload, "platform", "Platform", 80);
    const handle = requiredText(payload, "handle", "Handle", 320);
    await prisma.contactHandle.update({ where: { id }, data: { platform, handle } });
    return { ok: true, id, contactId: row.contactId, platform, handle };
}

export async function deleteHandle(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredText(payload, "id", "Handle", 200);
    const row = await prisma.contactHandle.findFirst({
        where: { id, contact: { userId } },
        select: { id: true, contactId: true },
    });
    if (!row) throw new Error("Handle not found.");
    await prisma.contactHandle.delete({ where: { id } });
    return { ok: true, id, contactId: row.contactId };
}

/** Lightweight canvas-side profile edits (how you met, relationship, etc.). */
export async function updateContactMeta(userId: string, payload: Record<string, unknown> = {}) {
    const id = requiredText(payload, "id", "Contact", 200);
    await ownedContact(userId, id);
    const data: {
        howWeMet?: string | null;
        relationshipType?: string | null;
        notes?: string | null;
        preferredContactMethod?: string | null;
    } = {};
    if (Object.prototype.hasOwnProperty.call(payload, "howWeMet")) {
        data.howWeMet = optionalText(payload, "howWeMet", 1_000);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "relationshipType")) {
        data.relationshipType = optionalText(payload, "relationshipType", 100);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "notes")) {
        data.notes = optionalText(payload, "notes", 8_000);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "preferredContactMethod")) {
        data.preferredContactMethod = optionalText(payload, "preferredContactMethod", 100);
    }
    if (Object.keys(data).length === 0) throw new Error("No contact fields to update.");
    await prisma.socialContact.update({ where: { id }, data });
    return { ok: true, id };
}
