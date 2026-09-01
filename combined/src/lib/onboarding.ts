import "server-only";

import { db } from "@/lib/db";

export interface OnboardingStep {
    id: string;
    label: string;
    description: string;
    href: string;
    done: boolean;
}

/** Activation checklist derived from real account data (cheap counts run in parallel). */
export async function getOnboardingSteps(userId: string): Promise<OnboardingStep[]> {
    const [profile, goal, workouts, meals, metrics, contacts, spotify, plaid] = await Promise.all([
        db.userProfile.findUnique({ where: { userId }, select: { activityLevel: true } }),
        db.nutritionGoal.findUnique({ where: { userId }, select: { calories: true } }),
        db.workout.count({ where: { userId, deletedAt: null } }),
        db.nutritionDay.count({ where: { userId } }),
        db.bodyMetric.count({ where: { userId } }),
        db.socialContact.count({ where: { userId } }),
        db.spotifyConnection.count({ where: { userId } }),
        db.plaidItem.count({ where: { userId } }),
    ]);

    return [
        { id: "goals", label: "Set your goals", description: "Tell us your targets so insights are tailored to you.", href: "/settings/goals", done: Boolean(profile?.activityLevel || goal?.calories) },
        { id: "workout", label: "Log your first workout", description: "Track sets, reps and PRs.", href: "/workouts/log", done: workouts > 0 },
        { id: "meal", label: "Track a meal", description: "Snap a photo or describe it — AI logs the macros.", href: "/nutrition", done: meals > 0 },
        { id: "metric", label: "Log a body metric", description: "Weigh in to start your trend line.", href: "/health/metrics", done: metrics > 0 },
        { id: "contact", label: "Add a contact", description: "Keep the people who matter close.", href: "/social/contacts/new", done: contacts > 0 },
        { id: "integration", label: "Connect an app", description: "Link Spotify, your bank and more.", href: "/settings/integrations", done: spotify + plaid > 0 },
    ];
}
