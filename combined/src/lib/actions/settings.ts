"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject, deleteUserObjects } from "@/lib/s3";
import { TRACKABLE_AREA_KEYS, type AreaKey } from "@/lib/areas";

function str(formData: FormData, key: string): string | null {
    const v = formData.get(key);
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
}

function num(formData: FormData, key: string): number | null {
    const v = str(formData, key);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function date(formData: FormData, key: string): Date | null {
    const v = str(formData, key);
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

function bool(formData: FormData, key: string): boolean {
    const v = str(formData, key);
    return v === "on" || v === "true" || v === "1";
}

// ============================================================
// Profile
// ============================================================

export async function updateProfile(formData: FormData) {
    const user = await requireUser();

    const name = str(formData, "name");
    const email = str(formData, "email");
    const username = str(formData, "username");
    const phone = str(formData, "phone");
    const gender = str(formData, "gender");
    const birthdate = date(formData, "birthdate");
    const heightCm = num(formData, "heightCm");

    if (!email) throw new Error("Email is required");

    // Uniqueness checks (case-insensitive email).
    const emailLower = email.toLowerCase();
    if (emailLower !== user.email.toLowerCase()) {
        const taken = await db.user.findFirst({ where: { email: emailLower, NOT: { id: user.id } } });
        if (taken) throw new Error("That email is already in use");
    }
    if (username) {
        const taken = await db.user.findFirst({ where: { username, NOT: { id: user.id } } });
        if (taken) throw new Error("That username is already taken");
    }

    // Avatar upload (optional).
    const avatarFile = formData.get("avatar") as File | null;
    let avatarKey: string | undefined;
    if (avatarFile && avatarFile.size > 0) {
        const stored = await uploadUserRasterImage(user.id, "profile", avatarFile);
        avatarKey = stored.fileKey;
    }

    try {
        await db.$transaction([
            db.user.update({
                where: { id: user.id },
                data: {
                    name,
                    email: emailLower,
                    username,
                    ...(avatarKey ? { avatarKey } : {}),
                },
            }),
            db.userProfile.upsert({
                where: { userId: user.id },
                update: { gender, birthdate, heightCm, phone },
                create: { userId: user.id, gender, birthdate, heightCm, phone },
            }),
        ]);
    } catch (error) {
        if (avatarKey) await deleteObject(avatarKey).catch(() => {});
        throw error;
    }

    if (avatarKey && user.avatarKey) await deleteObject(user.avatarKey).catch(() => {});

    revalidatePath("/settings");
}

// ============================================================
// Account: password + delete
// ============================================================

export async function changePassword(formData: FormData) {
    const user = await requireUser();
    const current = str(formData, "currentPassword");
    const next = str(formData, "newPassword");
    const confirm = str(formData, "confirmPassword");

    if (!current || !next || !confirm) throw new Error("All password fields are required");
    if (next.length < 8) throw new Error("New password must be at least 8 characters");
    if (next !== confirm) throw new Error("New passwords do not match");

    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) throw new Error("Current password is incorrect");

    const passwordHash = await bcrypt.hash(next, 10);
    await db.user.update({ where: { id: user.id }, data: { passwordHash } });
    revalidatePath("/settings/account");
}

export async function deleteAccount(formData: FormData) {
    const user = await requireUser();
    const confirmEmail = str(formData, "confirmEmail");
    if (!confirmEmail || confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
        throw new Error("Email confirmation does not match");
    }
    // Cascades remove all related rows (onDelete: Cascade in schema).
    await db.user.delete({ where: { id: user.id } });
    await deleteUserObjects(user.id).catch(() => {});

    const session = await getSession();
    session.destroy();
    redirect("/login");
}

// ============================================================
// Preferences
// ============================================================

export async function updatePreferences(formData: FormData) {
    const user = await requireUser();

    const unitSystem = str(formData, "unitSystem") === "METRIC" ? "METRIC" : "IMPERIAL";

    await db.settings.upsert({
        where: { userId: user.id },
        update: { unitSystem },
        create: { userId: user.id, unitSystem },
    });

    await db.userProfile.upsert({
        where: { userId: user.id },
        update: {
            waterGoalMl: num(formData, "waterGoalMl"),
            activityLevel: str(formData, "activityLevel"),
            dietGoal: str(formData, "dietGoal"),
            goalWeightKg: num(formData, "goalWeightKg"),
            goalBodyFatPct: num(formData, "goalBodyFatPct"),
            goalTargetDate: date(formData, "goalTargetDate"),
        },
        create: {
            userId: user.id,
            waterGoalMl: num(formData, "waterGoalMl"),
            activityLevel: str(formData, "activityLevel"),
            dietGoal: str(formData, "dietGoal"),
            goalWeightKg: num(formData, "goalWeightKg"),
            goalBodyFatPct: num(formData, "goalBodyFatPct"),
            goalTargetDate: date(formData, "goalTargetDate"),
        },
    });

    revalidatePath("/settings");
    revalidatePath("/settings/goals");
    revalidatePath("/health/goals");
    revalidatePath("/health");
    revalidatePath("/nutrition");
}

/** Update only the unit system (instant-save control). Revalidates everything so measurements refresh. */
export async function updateUnitSystem(system: "METRIC" | "IMPERIAL") {
    const user = await requireUser();
    const unitSystem = system === "METRIC" ? "METRIC" : "IMPERIAL";
    await db.settings.upsert({
        where: { userId: user.id },
        update: { unitSystem },
        create: { userId: user.id, unitSystem },
    });
    // Units appear across every module — revalidate the whole layout tree.
    revalidatePath("/", "layout");
}

// ============================================================
// Tracked areas of life (sidebar visibility)
// ============================================================

/** Persist which areas of life are hidden from the sidebar + dashboard. */
export async function updateTrackedAreas(hidden: string[]) {
    const user = await requireUser();
    const clean = hidden.filter((k): k is AreaKey => (TRACKABLE_AREA_KEYS as string[]).includes(k));

    await db.settings.upsert({
        where: { userId: user.id },
        update: { sidebarConfig: { hidden: clean } },
        create: { userId: user.id, sidebarConfig: { hidden: clean } },
    });

    // The sidebar lives in the root app layout, so revalidate the whole layout.
    revalidatePath("/", "layout");
    revalidatePath("/settings/tracking");
    revalidatePath("/dashboard");
}

// ============================================================
// AI settings
// ============================================================

export async function updateAiSettings(formData: FormData) {
    const user = await requireUser();
    const aiBudgetUsd = num(formData, "aiBudgetUsd");

    await db.settings.upsert({
        where: { userId: user.id },
        update: {
            aiEnabled: bool(formData, "aiEnabled"),
            aiModel: str(formData, "aiModel"),
            aiBudgetUsd,
            coachStyle: str(formData, "coachStyle"),
        },
        create: {
            userId: user.id,
            aiEnabled: bool(formData, "aiEnabled"),
            aiModel: str(formData, "aiModel"),
            aiBudgetUsd,
            coachStyle: str(formData, "coachStyle"),
        },
    });

    revalidatePath("/settings/ai");
}
