export type LearningProvider = "youtube" | "udemy" | "coursera" | "other";

/** Detect a supported course provider using exact or dot-boundary host matches. */
export function detectLearningProvider(value: string | undefined): LearningProvider {
    if (!value) return "other";
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "other";
        const host = parsed.hostname.toLowerCase();
        if (
            host === "youtube.com" ||
            host.endsWith(".youtube.com") ||
            host === "youtube-nocookie.com" ||
            host.endsWith(".youtube-nocookie.com") ||
            host === "youtu.be"
        ) return "youtube";
        if (host === "udemy.com" || host.endsWith(".udemy.com")) return "udemy";
        if (host === "coursera.org" || host.endsWith(".coursera.org")) return "coursera";
        return "other";
    } catch {
        return "other";
    }
}
