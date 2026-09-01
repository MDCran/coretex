import "server-only";

import { z } from "zod";

/**
 * Zod-based FormData validation for learning server actions.
 *
 * FormData values arrive as strings (or File). These helpers coerce + validate
 * a FormData payload against a Zod object schema, throwing a single readable
 * error suitable for surfacing in a form's error state.
 */

/** Collapse a FormData into a plain string record (ignores File entries). */
export function formObject(fd: FormData): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of fd.entries()) {
        if (typeof value === "string") out[key] = value;
    }
    return out;
}

/** Validate a FormData payload against a Zod object schema. Throws on failure. */
export function parseForm<S extends z.ZodType>(schema: S, fd: FormData): z.infer<S> {
    const result = schema.safeParse(formObject(fd));
    if (!result.success) {
        const issue = result.error.issues[0];
        const path = issue?.path?.join(".") || "form";
        throw new Error(issue ? `${path}: ${issue.message}` : "Invalid input.");
    }
    return result.data;
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

// ── Reusable field coercers (FormData strings → typed values) ────────────────

export const zText = z.string().trim().min(1, "Required");
export const zOptText = z.preprocess(emptyToUndefined, z.string().trim().optional());
export const zId = z.string().trim().min(1, "Missing id");
export const zNum = z.coerce.number();
export const zOptNum = z.preprocess(emptyToUndefined, z.coerce.number().optional());
export const zInt = z.coerce.number().int();
export const zOptInt = z.preprocess(emptyToUndefined, z.coerce.number().int().optional());
/** Checkbox/boolean: "on" | "true" | "1" → true; missing/empty → false. */
export const zBool = z.preprocess((v) => v === "true" || v === "on" || v === "1" || v === true, z.boolean());
/** Optional date from a yyyy-mm-dd or datetime-local string. Empty → undefined. */
export const zOptDate = z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? new Date(v) : undefined),
    z.date({ message: "Invalid date" }).optional(),
);
