import { fileUrl } from "@/lib/files";

/**
 * Deterministic monogram (1-2 letters) + a semantic-safe utility background for a
 * company name. Used as the logo fallback when no uploaded logo / remote match
 * exists. Pure + no React, so it is safe to call from server or client.
 */
const MONOGRAM_BG = [
    "bg-utility-blue-100 text-utility-blue-700",
    "bg-utility-indigo-100 text-utility-indigo-700",
    "bg-utility-purple-100 text-utility-purple-700",
    "bg-utility-pink-100 text-utility-pink-700",
    "bg-utility-orange-100 text-utility-orange-700",
    "bg-utility-green-100 text-utility-green-700",
    "bg-utility-sky-100 text-utility-sky-700",
    "bg-utility-fuchsia-100 text-utility-fuchsia-700",
] as const;

const CORP_SUFFIXES = new Set(["inc", "llc", "ltd", "corp", "co", "company", "group", "plc", "gmbh", "ag", "sa"]);

export function companyMonogram(name: string | null | undefined): { initials: string; colorClass: string } {
    const clean = (name ?? "").trim();
    const words = clean.split(/\s+/).filter(Boolean);
    let initials = "";
    if (words.length >= 2) {
        initials = (words[0][0] ?? "") + (words[1][0] ?? "");
    } else if (words.length === 1) {
        initials = words[0].slice(0, 2);
    }
    initials = initials.toUpperCase() || "?";

    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
        hash = (hash * 31 + clean.charCodeAt(i)) | 0;
    }
    const colorClass = MONOGRAM_BG[Math.abs(hash) % MONOGRAM_BG.length];

    return { initials, colorClass };
}

/** Candidate logo sources for a company, in fallback priority order. */
export type CompanyLogoSources = {
    /** Preferred: ordered list of image URLs to try before monogram fallback. */
    candidates?: string[];
    /** @deprecated Use `candidates`. Same-origin uploaded logo URL. */
    uploadedUrl?: string;
    /** @deprecated Use `candidates`. LogoKit URL. */
    logokitUrl?: string;
    /** @deprecated Use `candidates`. Google favicon URL. */
    faviconUrl?: string;
};

/** Strip protocol, path and www. from a raw domain/URL → bare host. */
export function cleanDomain(raw: string): string {
    return raw
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/^www\./, "")
        .toLowerCase();
}

/** Guess `.com` domains from a company name when none is stored (best-effort). */
function guessDomainsFromName(name: string | null | undefined): string[] {
    const words = (name ?? "")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/[^a-z0-9]/g, ""))
        .filter((w) => w.length > 0 && !CORP_SUFFIXES.has(w));
    if (!words.length) return [];

    const domains: string[] = [];
    const add = (host: string) => {
        if (host.length >= 2 && !domains.includes(host)) domains.push(host);
    };

    add(`${words.join("")}.com`);
    if (words.length >= 2) add(`${words[0]}${words[1]}.com`);
    for (const w of words) {
        if (w.length >= 4) add(`${w}.com`);
    }
    return domains;
}

/** Collect candidate domains: stored website → application URL host → name guess. */
function collectDomains(
    company: { websiteDomain?: string | null; name?: string | null },
    opts?: { fallbackUrl?: string | null },
): string[] {
    const out: string[] = [];
    const add = (raw?: string | null) => {
        if (!raw) return;
        const d = cleanDomain(raw);
        if (d && !out.includes(d)) out.push(d);
    };
    add(company.websiteDomain);
    if (opts?.fallbackUrl) add(opts.fallbackUrl);
    if (!out.length) {
        for (const guessed of guessDomainsFromName(company.name)) add(guessed);
    }
    return out;
}

/** Remote logo URLs for a domain, highest quality first. */
function remoteLogoUrls(domain: string): string[] {
    const clean = cleanDomain(domain);
    if (!clean) return [];
    const urls: string[] = [];
    const token = process.env.NEXT_PUBLIC_LOGOKIT_TOKEN;
    if (token) urls.push(`https://img.logokit.com/${clean}?token=${encodeURIComponent(token)}`);
    urls.push(
        `https://logo.clearbit.com/${clean}`,
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=128`,
        `https://icons.duckduckgo.com/ip3/${clean}.ico`,
    );
    return urls;
}

/**
 * Resolve ordered logo candidates for a company. The client `<CompanyLogo>` walks
 * the list and only shows a monogram when every candidate fails.
 */
export function companyLogoSrc(
    company: { logoKey?: string | null; websiteDomain?: string | null; name?: string | null },
    opts?: { fallbackUrl?: string | null },
): CompanyLogoSources {
    const candidates: string[] = [];
    if (company.logoKey) candidates.push(fileUrl(company.logoKey));

    for (const domain of collectDomains(company, opts)) {
        for (const url of remoteLogoUrls(domain)) {
            if (!candidates.includes(url)) candidates.push(url);
        }
    }

    // Legacy fields for any code still reading them directly.
    const domains = collectDomains(company, opts);
    const primary = domains[0];
    const sources: CompanyLogoSources = { candidates };
    if (company.logoKey) sources.uploadedUrl = fileUrl(company.logoKey);
    if (primary) {
        sources.faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(primary)}&sz=128`;
        const token = process.env.NEXT_PUBLIC_LOGOKIT_TOKEN;
        if (token) sources.logokitUrl = `https://img.logokit.com/${primary}?token=${encodeURIComponent(token)}`;
    }
    return sources;
}

/** Flatten a CompanyLogoSources object into a de-duplicated URL list. */
export function logoCandidateUrls(src: CompanyLogoSources | string | null | undefined): string[] {
    if (!src) return [];
    if (typeof src === "string") return src ? [src] : [];
    const list: string[] = [];
    if (src.candidates?.length) list.push(...src.candidates);
    if (src.uploadedUrl) list.push(src.uploadedUrl);
    if (src.logokitUrl) list.push(src.logokitUrl);
    if (src.faviconUrl) list.push(src.faviconUrl);
    return list.filter((v, i) => v && list.indexOf(v) === i);
}
