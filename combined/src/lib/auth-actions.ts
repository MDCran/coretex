"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { safeNextPath } from "@/lib/safe-next-path";

export type AuthState = { error?: string } | undefined;

const signupSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
});

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
    const parsed = signupSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
        return { error: parsed.error.issues[0].message };
    }
    const { name, email, password, confirmPassword } = parsed.data;
    if (password !== confirmPassword) {
        return { error: "Passwords do not match" };
    }

    const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
        return { error: "An account with this email already exists" };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.user.create({
        data: {
            email: email.toLowerCase(),
            name,
            passwordHash,
            profile: { create: {} },
            settings: { create: {} },
        },
    });

    const session = await getSession();
    session.userId = user.id;
    await session.save();

    redirect("/dashboard");
}

const loginSchema = z.object({
    email: z.string().min(1, "Email is required"),
    password: z.string().min(1, "Password is required"),
});

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
    const parsed = loginSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
        return { error: parsed.error.issues[0].message };
    }
    const { email, password } = parsed.data;

    const user = await db.user.findFirst({
        where: { OR: [{ email: email.toLowerCase() }, { username: email }] },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return { error: "Invalid email or password" };
    }

    const session = await getSession();
    session.userId = user.id;
    await session.save();

    redirect(safeNextPath(formData.get("next")));
}

export async function logout() {
    const session = await getSession();
    session.destroy();
    redirect("/login");
}
