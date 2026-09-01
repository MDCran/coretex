import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

/** Returns the logged-in user or null. Cached per-request. */
export const getCurrentUser = cache(async () => {
    const session = await getSession();
    if (!session.userId) return null;
    return db.user.findUnique({ where: { id: session.userId } });
});

/** Returns the logged-in user or redirects to /login. Use in (app) pages/layouts. */
export async function requireUser() {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    return user;
}
