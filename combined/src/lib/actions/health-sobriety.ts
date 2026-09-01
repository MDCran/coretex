"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, parseDateTime, str } from "./health-shared";

function revalidate() {
    revalidatePath("/health/sobriety");
    revalidatePath("/health");
}

export async function createCounter(fd: FormData) {
    const user = await requireUser();
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    await db.sobrietyCounter.create({
        data: {
            userId: user.id,
            name,
            description: str(fd, "description"),
            color: str(fd, "color"),
            icon: str(fd, "icon"),
            startedAt: parseDateTime(str(fd, "startedAt")),
        },
    });
    revalidate();
}

export async function updateCounter(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    await db.sobrietyCounter.updateMany({
        where: { id, userId: user.id },
        data: {
            name,
            description: str(fd, "description"),
            color: str(fd, "color"),
            icon: str(fd, "icon"),
            startedAt: parseDateTime(str(fd, "startedAt")),
        },
    });
    revalidate();
}

export async function archiveCounter(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const archived = str(fd, "archived") === "false" ? false : true;
    await db.sobrietyCounter.updateMany({ where: { id, userId: user.id }, data: { archived } });
    revalidate();
}

export async function deleteCounter(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.sobrietyCounter.deleteMany({ where: { id, userId: user.id } });
    revalidate();
}

/**
 * Log a relapse on a counter. Restarts the current streak from the relapse
 * moment AND records a matching SubstanceLog (substanceType = counter name)
 * so the slip shows up in the unified use history. Amount/unit/notes are
 * optional extra detail carried over from the relapse form.
 */
export async function logRelapse(fd: FormData) {
    const user = await requireUser();
    const counterId = str(fd, "counterId");
    if (!counterId) throw new Error("Missing counter");
    // Ensure the counter belongs to the user.
    const counter = await db.sobrietyCounter.findFirst({ where: { id: counterId, userId: user.id } });
    if (!counter) throw new Error("Counter not found");

    const relapsedAt = parseDateTime(str(fd, "relapsedAt"));
    const notes = str(fd, "notes");
    const amount = num(fd, "amount");
    const unit = str(fd, "unit");

    await db.$transaction([
        db.sobrietyRelapse.create({
            data: { counterId, relapsedAt, notes },
        }),
        // Restart the current streak from the relapse moment.
        db.sobrietyCounter.update({ where: { id: counterId }, data: { startedAt: relapsedAt } }),
        // Mirror the slip into the substance log under the counter's name.
        db.substanceLog.create({
            data: {
                userId: user.id,
                substanceType: counter.name,
                amount,
                unit,
                loggedAt: relapsedAt,
                notes,
            },
        }),
    ]);
    revalidate();
}

export async function deleteRelapse(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    // Scope the delete to a relapse belonging to one of the user's counters.
    const relapse = await db.sobrietyRelapse.findFirst({ where: { id, counter: { userId: user.id } } });
    if (!relapse) throw new Error("Relapse not found");
    await db.sobrietyRelapse.delete({ where: { id } });
    revalidate();
}

/**
 * Quick "Log use": records a SubstanceLog for any type (a counter name, a
 * custom type, or a built-in). If a NON-archived counter exists whose name
 * matches the logged type, the use is also treated as a slip — the counter's
 * streak restarts and a SobrietyRelapse is recorded (same semantics as
 * "I relapsed").
 */
export async function logUse(fd: FormData) {
    const user = await requireUser();
    const substanceType = str(fd, "substanceType");
    if (!substanceType) throw new Error("Type is required");

    const loggedAt = parseDateTime(str(fd, "loggedAt"));
    const notes = str(fd, "notes");
    const amount = num(fd, "amount");
    const unit = str(fd, "unit");

    // Match a counter by name (case-insensitive) so logging a use on a tracked
    // substance also resets its streak.
    const counter = await db.sobrietyCounter.findFirst({
        where: { userId: user.id, archived: false, name: { equals: substanceType, mode: "insensitive" } },
    });

    const ops: any[] = [
        db.substanceLog.create({
            data: { userId: user.id, substanceType, amount, unit, loggedAt, notes },
        }),
    ];
    if (counter) {
        ops.push(
            db.sobrietyRelapse.create({ data: { counterId: counter.id, relapsedAt: loggedAt, notes } }),
            db.sobrietyCounter.update({ where: { id: counter.id }, data: { startedAt: loggedAt } }),
        );
    }
    await db.$transaction(ops);
    revalidate();
}

export async function deleteSubstanceLog(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.substanceLog.deleteMany({ where: { id, userId: user.id } });
    revalidate();
}

export async function createCustomSubstanceType(fd: FormData) {
    const user = await requireUser();
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    await db.customSubstanceType.create({ data: { userId: user.id, name } });
    revalidate();
}

export async function deleteCustomSubstanceType(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.customSubstanceType.deleteMany({ where: { id, userId: user.id } });
    revalidate();
}
