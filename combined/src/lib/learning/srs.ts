/**
 * SM-2 spaced-repetition scheduling (SuperMemo 2). Pure functions shared by the
 * flashcard server actions and the review UI. No imports.
 */

export interface SrsState {
    easeFactor: number;
    intervalDays: number;
    repetitions: number;
}

export interface SrsSchedule extends SrsState {
    dueDate: Date;
}

/** Recall quality buttons map to SM-2 quality scores (0-5). */
export type RecallGrade = "again" | "hard" | "good" | "easy";

export function gradeToQuality(grade: RecallGrade): number {
    switch (grade) {
        case "again":
            return 1;
        case "hard":
            return 3;
        case "good":
            return 4;
        case "easy":
            return 5;
    }
}

const MIN_EASE = 1.3;

/**
 * Compute the next schedule from a card's current state and a recall quality.
 * Quality < 3 lapses the card (repetitions reset, review again tomorrow).
 */
export function schedule(state: SrsState, quality: number, now: Date = new Date()): SrsSchedule {
    let { easeFactor, intervalDays, repetitions } = state;

    if (quality < 3) {
        repetitions = 0;
        intervalDays = 1;
    } else {
        if (repetitions === 0) intervalDays = 1;
        else if (repetitions === 1) intervalDays = 6;
        else intervalDays = Math.round(intervalDays * easeFactor);
        repetitions += 1;
    }

    // Update ease factor (clamped to a sane floor).
    easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < MIN_EASE) easeFactor = MIN_EASE;
    easeFactor = Math.round(easeFactor * 100) / 100;

    const dueDate = new Date(now);
    dueDate.setHours(0, 0, 0, 0);
    dueDate.setDate(dueDate.getDate() + Math.max(1, intervalDays));

    return { easeFactor, intervalDays, repetitions, dueDate };
}

/** A card is due when it has never been scheduled or its dueDate has passed. */
export function isDue(dueDate: Date | null | undefined, now: Date = new Date()): boolean {
    if (!dueDate) return true;
    return dueDate.getTime() <= now.getTime();
}
