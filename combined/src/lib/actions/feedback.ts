"use server";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export type FeedbackCategory = "idea" | "bug" | "praise" | "other";

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
    idea: "Idea",
    bug: "Bug",
    praise: "Praise",
    other: "Feedback",
};

/**
 * Capture product feedback. Persisted as a SYSTEM notification (zero schema change)
 * so it survives and is queryable for an admin board later; the user gets a receipt
 * in their notifications. Replace with a dedicated Feedback model once the workspace
 * layer lands.
 */
export async function submitFeedback(input: { message: string; category: FeedbackCategory }): Promise<void> {
    const user = await requireUser();
    const message = input.message?.trim();
    if (!message) throw new Error("Please enter some feedback first.");
    if (message.length > 4000) throw new Error("That's a bit long — please keep feedback under 4000 characters.");

    const category = (["idea", "bug", "praise", "other"] as const).includes(input.category) ? input.category : "other";

    await db.notification.create({
        data: {
            userId: user.id,
            kind: "SYSTEM",
            severity: "INFO",
            title: `${CATEGORY_LABEL[category]} submitted — thank you!`,
            body: `[feedback:${category}] ${message}`,
            href: "/changelog",
        },
    });
}
