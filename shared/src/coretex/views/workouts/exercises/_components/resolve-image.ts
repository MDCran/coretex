// @ts-nocheck
/**
 * Resolves an exercise image reference to a loadable absolute URL.
 *
 * Most rows store absolute URLs (e.g. the free-exercise-db catalog uses
 * https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/.../0.jpg),
 * but some imported/legacy rows can hold a path relative to that catalog
 * (e.g. "Face_Pull/0.jpg"). This normalizes both forms so thumbnails render.
 */
const FREE_EXERCISE_DB_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

export function resolveExerciseImage(src: string | null | undefined): string | null {
    if (!src) return null;
    const trimmed = src.trim();
    if (!trimmed) return null;
    // Already absolute (http/https), a same-origin API path, or a data URI: use as-is.
    if (/^(?:(?:https?:)?\/\/|data:|blob:|file:)/i.test(trimmed) || trimmed.startsWith("/")) {
        return trimmed;
    }
    // Otherwise treat as a free-exercise-db relative path.
    return FREE_EXERCISE_DB_BASE + trimmed.replace(/^\.?\/+/, "");
}
