"use server";

import { revalidatePath } from "next/cache";
import { JobLevel, JobStatus, Prisma, SuggestionStatus, WorkType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aiConfigured, JOB_SEARCH_MODEL, runClaudeWithWebSearch } from "@/lib/ai/claude";
import { cleanDomain } from "@/lib/jobs/logos";
import { geocodeQuery, haversineMiles, nearestLocation } from "@/lib/jobs/geocode";

/**
 * AI job search: saved search locations, the search profile, and the AI-found
 * leads / suggested companies that live in the "AI suggested" tables until the
 * user promotes them to real applications / companies.
 */

// ------------------------------------------------------------------
// Small form helpers (mirrors lib/actions/jobs.ts)
// ------------------------------------------------------------------

function str(fd: FormData, k: string) {
    const v = fd.get(k);
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
}
function num(fd: FormData, k: string) {
    const s = str(fd, k);
    if (s == null) return null;
    const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
}
function bool(fd: FormData, k: string) {
    const v = fd.get(k);
    return v === "on" || v === "true" || v === "1";
}
function list(fd: FormData, k: string): string[] {
    return (str(fd, k) ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function revalidateSearch(companyId?: string) {
    revalidatePath("/career/search");
    revalidatePath("/career");
    revalidatePath("/career/applications");
    revalidatePath("/career/companies");
    if (companyId) revalidatePath(`/career/companies/${companyId}`);
}

// ------------------------------------------------------------------
// Search locations
// ------------------------------------------------------------------

export async function addSearchLocation(fd: FormData) {
    const user = await requireUser();
    const label = str(fd, "label");
    const lat = num(fd, "lat");
    const lon = num(fd, "lon");
    if (!label || lat == null || lon == null) throw new Error("Pick a location from the suggestions.");

    const count = await db.jobSearchLocation.count({ where: { userId: user.id } });
    await db.jobSearchLocation.create({
        data: {
            userId: user.id,
            label,
            shortLabel: str(fd, "shortLabel"),
            lat,
            lon,
            placeType: str(fd, "placeType"),
            countryCode: str(fd, "countryCode"),
            priority: count, // appended to the end of the priority order
            maxResults: num(fd, "maxResults") ?? 50,
        },
    });
    revalidateSearch();
}

export async function updateSearchLocation(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const loc = await db.jobSearchLocation.findFirst({ where: { id, userId: user.id } });
    if (!loc) throw new Error("Location not found");

    const maxResults = num(fd, "maxResults");
    const priority = num(fd, "priority");
    await db.jobSearchLocation.update({
        where: { id },
        data: {
            enabled: fd.has("enabled") ? bool(fd, "enabled") : loc.enabled,
            maxResults: maxResults != null ? Math.max(1, Math.round(maxResults)) : loc.maxResults,
            priority: priority != null ? Math.round(priority) : loc.priority,
        },
    });
    revalidateSearch();
}

export async function deleteSearchLocation(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const loc = await db.jobSearchLocation.findFirst({ where: { id, userId: user.id } });
    if (!loc) throw new Error("Location not found");
    await db.jobSearchLocation.delete({ where: { id } });
    revalidateSearch();
}

// ------------------------------------------------------------------
// Search profile
// ------------------------------------------------------------------

const LEVEL_VALUES = new Set<string>(Object.values(JobLevel));

export async function getOrCreateProfile(userId: string) {
    return db.jobSearchProfile.upsert({ where: { userId }, create: { userId }, update: {} });
}

export async function updateSearchProfile(fd: FormData) {
    const user = await requireUser();
    const levels = fd
        .getAll("levels")
        .map(String)
        .filter((v) => LEVEL_VALUES.has(v)) as JobLevel[];

    const distance = num(fd, "distanceMiles") ?? 50;
    const shared = {
        profileText: str(fd, "profileText"),
        keywords: list(fd, "keywords"),
        excludeKeywords: list(fd, "excludeKeywords"),
        levels,
        distanceMiles: Math.round(distance),
        allowRemote: bool(fd, "allowRemote"),
        includeNewCompanies: bool(fd, "includeNewCompanies"),
        minSalary: num(fd, "minSalary") ? Math.round(num(fd, "minSalary")!) : null,
        resultsPerLocation: num(fd, "resultsPerLocation") ? Math.round(num(fd, "resultsPerLocation")!) : 50,
        autoGhost: bool(fd, "autoGhost"),
        ghostAfterDays: num(fd, "ghostAfterDays") ? Math.max(1, Math.round(num(fd, "ghostAfterDays")!)) : 21,
        followUpAfterDays: num(fd, "followUpAfterDays") ? Math.max(1, Math.round(num(fd, "followUpAfterDays")!)) : 7,
    };
    await db.jobSearchProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...shared },
        update: shared,
    });
    revalidateSearch();
}

// ------------------------------------------------------------------
// Lead generation (live web search)
// ------------------------------------------------------------------

/** One raw role as returned by the model. */
interface RawLead {
    companyName?: string;
    companyDomain?: string | null;
    title?: string;
    level?: string | null;
    descriptionSnippet?: string | null;
    applicationUrl?: string | null;
    salaryMin?: number | null;
    salaryMax?: number | null;
    salaryCurrency?: string | null;
    deadline?: string | null;
    locationText?: string | null;
    isRemote?: boolean | null;
    matchScore?: number | null;
    matchReason?: string | null;
}

function normLevel(v: string | null | undefined): JobLevel {
    const up = (v ?? "").toUpperCase().replace(/[^A-Z]/g, "");
    if (up.includes("INTERN")) return JobLevel.INTERNSHIP;
    if (up.includes("ENTRY") || up.includes("GRAD") || up.includes("NEW")) return JobLevel.ENTRY;
    if (up.includes("JUNIOR") || up === "JR") return JobLevel.JUNIOR;
    if (up.includes("SENIOR") || up === "SR") return JobLevel.SENIOR;
    if (up.includes("LEAD") || up.includes("STAFF") || up.includes("PRINCIPAL")) return JobLevel.LEAD;
    if (up.includes("MID") || up.includes("INTERMEDIATE")) return JobLevel.MID;
    return (LEVEL_VALUES.has(up) ? (up as JobLevel) : JobLevel.UNKNOWN);
}

function parseDeadline(v: string | null | undefined): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

// ------------------------------------------------------------------
// Soft-delete: NEVER hard-delete suggested roles — back them up first
// ------------------------------------------------------------------

/** Lead fields we mirror into DeletedSuggestedRole. */
type BackupableLead = {
    id: string;
    companyName: string;
    companyDomain: string | null;
    title: string;
    level: JobLevel;
    descriptionSnippet: string | null;
    applicationUrl: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    locationText: string | null;
    lat: number | null;
    lon: number | null;
    isRemote: boolean;
    matchScore: number | null;
    matchReason: string | null;
    status: SuggestionStatus;
};

const BACKUP_SELECT = {
    id: true,
    companyName: true,
    companyDomain: true,
    title: true,
    level: true,
    descriptionSnippet: true,
    applicationUrl: true,
    salaryMin: true,
    salaryMax: true,
    salaryCurrency: true,
    locationText: true,
    lat: true,
    lon: true,
    isRemote: true,
    matchScore: true,
    matchReason: true,
    status: true,
} satisfies Prisma.JobLeadSelect;

/**
 * Copy the given leads into DeletedSuggestedRole (originalStatus = current status),
 * then hard-delete the JobLead rows. This is the ONLY way leads leave the suggestions
 * list — they are always recoverable from the backup until the user purges them.
 */
async function softDeleteLeads(userId: string, leads: BackupableLead[]): Promise<void> {
    if (leads.length === 0) return;
    await db.deletedSuggestedRole.createMany({
        data: leads.map((l) => ({
            userId,
            companyName: l.companyName,
            companyDomain: l.companyDomain,
            title: l.title,
            level: String(l.level),
            descriptionSnippet: l.descriptionSnippet,
            applicationUrl: l.applicationUrl,
            salaryMin: l.salaryMin,
            salaryMax: l.salaryMax,
            salaryCurrency: l.salaryCurrency,
            locationText: l.locationText,
            lat: l.lat,
            lon: l.lon,
            isRemote: l.isRemote,
            matchScore: l.matchScore,
            matchReason: l.matchReason,
            originalStatus: String(l.status),
        })),
    });
    await db.jobLead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
}

/** Back up + delete the NEW leads matching a where-filter (used in pre-run cleanup paths). */
async function softDeleteNewLeadsWhere(userId: string, where: Prisma.JobLeadWhereInput): Promise<void> {
    const leads = await db.jobLead.findMany({
        where: { ...where, userId, status: SuggestionStatus.NEW },
        select: BACKUP_SELECT,
    });
    await softDeleteLeads(userId, leads);
}

/**
 * Build the set of fingerprints already known to the user: every existing JobLead
 * (any status) plus every backed-up DeletedSuggestedRole. Used to skip AI-returned
 * roles the user has already seen, added, dismissed, or removed.
 */
async function loadKnownFingerprints(userId: string): Promise<Set<string>> {
    const [leads, deleted, apps] = await Promise.all([
        db.jobLead.findMany({
            where: { userId },
            select: { applicationUrl: true, companyName: true, title: true, locationText: true },
        }),
        db.deletedSuggestedRole.findMany({
            where: { userId },
            select: { applicationUrl: true, companyName: true, title: true, locationText: true },
        }),
        // Exclude roles the user already tracks as applications, so suggestions never
        // re-surface something that's already in the Applications area.
        db.jobApplication.findMany({
            where: { userId },
            select: { applicationUrl: true, role: true, location: true, company: { select: { name: true } } },
        }),
    ]);
    const set = new Set<string>();
    for (const l of [...leads, ...deleted]) set.add(fingerprint(l));
    for (const a of apps) {
        set.add(fingerprint({ applicationUrl: a.applicationUrl, companyName: a.company?.name ?? null, title: a.role, locationText: a.location }));
    }
    return set;
}

/** Read the per-pass error log accumulated on a run's progress JSON. */
function runProgressErrors(run: { progress: Prisma.JsonValue | null }): Array<{ pass: number; message: string }> {
    const p = (run.progress ?? {}) as { errors?: Array<{ pass: number; message: string }> };
    return Array.isArray(p.errors) ? p.errors : [];
}

/** Read the cumulative token count accumulated on a run's progress JSON. */
function runProgressTokens(run: { progress: Prisma.JsonValue | null }): number {
    const p = (run.progress ?? {}) as { tokensUsed?: number };
    return typeof p.tokensUsed === "number" ? p.tokensUsed : 0;
}

/** Lower-case, collapse internal whitespace, drop surrounding noise. */
function normText(v: string | null | undefined): string {
    return (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Normalize a URL for comparison: strip protocol, querystring, hash, and trailing slash. */
function normUrl(v: string | null | undefined): string {
    let s = (v ?? "").trim().toLowerCase();
    if (!s) return "";
    s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
    s = s.split("?")[0].split("#")[0];
    s = s.replace(/\/+$/, "");
    return s;
}

/**
 * A normalized composite key for a role. Combines company | title | location with the
 * normalized application URL so the same posting collapses across passes and re-runs,
 * even when one source omits the URL or formats the location differently.
 */
function fingerprint(l: { applicationUrl?: string | null; companyName?: string | null; title?: string | null; locationText?: string | null }): string {
    return [normText(l.companyName), normText(l.title), normText(l.locationText), normUrl(l.applicationUrl)].join("|");
}

// ------------------------------------------------------------------
// Cost tuning for job-search AI calls (Haiku, lean tokens, more roles/call)
// ------------------------------------------------------------------

/** Lean token cap — Haiku returns dense JSON; 8k is plenty for ~40 roles. */
const SEARCH_MAX_TOKENS = 8000;
/** Live searches per pass. Enough to cover LinkedIn + Indeed + Handshake + Google + company sites. */
const SEARCH_MAX_SEARCHES = 8;
/** Default roles requested per pass when the profile doesn't say otherwise. */
const DEFAULT_RESULTS_PER_PASS = 40;

/**
 * Job search always uses Haiku — the global Settings.aiModel applies to coaching/analysis
 * features, not to bulk search where cost per pass adds up fast.
 */
function searchModel(_settings?: { aiModel?: string | null } | null): string {
    return JOB_SEARCH_MODEL;
}

const SEARCH_SYSTEM = `You are a meticulous job-search aggregator with live web access.
Use web search to find REAL, currently-open job postings that match the candidate's profile.
Search these sources to discover roles: LinkedIn Jobs, Indeed, jobfinder, Handshake, Google Jobs, and the careers / ATS pages of relevant companies (Greenhouse, Lever, Workday, Ashby, etc.). Run multiple distinct searches (e.g. "<keywords> <location> site:linkedin.com/jobs", on Indeed, on jobfinder, on Handshake, on Google Jobs, and company career pages) so coverage is broad.
Rules:
- Only include postings you actually found via search and that appear currently open. Never invent listings or URLs.
- PRECISION OVER VOLUME: only return roles that genuinely match the candidate's target keywords, experience level, and location. A handful of accurate, well-matched, real roles is far better than many loose or fabricated ones. Drop anything you're unsure is real and currently open.
- Prefer the official application URL (company careers page or the ATS link) when available; otherwise use the job-board listing URL (LinkedIn/Indeed/jobfinder/Handshake/Google) you actually found.
- Estimate the level (INTERNSHIP, ENTRY, JUNIOR, MID, SENIOR, LEAD) from the posting's title/requirements.
- Only include roles the candidate is genuinely QUALIFIED for. Respect the requested experience levels, and exclude any posting whose stated requirements (years of experience, seniority, security clearance, advanced degrees, niche skills the candidate lacks) clearly exceed the candidate's background. When in doubt about a stretch role, leave it out.
- matchScore is 0-100 for how well the role fits THIS candidate's background and keywords; matchReason is one short sentence on fit/qualification (e.g. "Entry-level, matches your CS background").
- For salary, give annual numbers in the role's currency; null if not stated.
- locationText must be "City, State, Country" (or "City, Country"); set isRemote true for fully remote roles.
- Respond with ONLY a JSON array (no prose) of objects with keys: companyName, companyDomain, title, level, descriptionSnippet, applicationUrl, salaryMin, salaryMax, salaryCurrency, deadline (ISO date or null), locationText, isRemote, matchScore, matchReason.`;

function buildPrompt(opts: {
    profileText: string | null;
    keywords: string[];
    excludeKeywords: string[];
    levels: JobLevel[];
    distanceMiles: number;
    minSalary: number | null;
    target: string;
    isRemote: boolean;
    limit: number;
    onlyCompany?: string;
    /** Search across several saved areas at once (used for the "roles at my companies" pass). */
    locations?: string[];
    /** When searching by location, also accept fully-remote roles. */
    allowRemote?: boolean;
    /** The user's tracked companies — scan their careers/ATS pages too (location passes only). */
    trackedCompanies?: string[];
}): string {
    const lines: string[] = [];
    lines.push(`Candidate profile: ${opts.profileText || "(not specified)"}`);
    if (opts.keywords.length) lines.push(`Target roles / keywords: ${opts.keywords.join(", ")}`);
    if (opts.excludeKeywords.length) lines.push(`Avoid roles matching: ${opts.excludeKeywords.join(", ")}`);
    if (opts.levels.length) {
        lines.push(`Only return roles at these experience levels — exclude anything more senior or more junior: ${opts.levels.join(", ")}.`);
    } else {
        lines.push(`Only return roles the candidate is realistically qualified for based on the profile above — exclude roles demanding seniority or experience they don't have.`);
    }
    if (opts.minSalary) lines.push(`Minimum acceptable annual salary: ${opts.minSalary}`);
    if (opts.onlyCompany) {
        lines.push(`ONLY return openings at this specific employer: ${opts.onlyCompany}.`);
    }
    if (opts.isRemote) {
        lines.push(`Find fully REMOTE openings (remote within the candidate's country).`);
    } else if (opts.locations && opts.locations.length > 0) {
        const within = `within about ${opts.distanceMiles} miles of any of these areas: ${opts.locations.join("; ")}`;
        lines.push(opts.allowRemote ? `Find openings ${within} — or fully remote roles.` : `Find openings ${within}.`);
    } else {
        lines.push(`Find openings located within about ${opts.distanceMiles} miles of: ${opts.target}.`);
    }
    if (!opts.onlyCompany && opts.trackedCompanies && opts.trackedCompanies.length > 0) {
        lines.push(`Also check these companies' own careers/ATS pages for matching roles: ${opts.trackedCompanies.join(", ")}.`);
    }
    lines.push(`Search LinkedIn Jobs, Indeed, jobfinder, Handshake, Google Jobs, and relevant companies' careers/ATS pages for this. Run a separate search per source so you find roles that any single board would miss.`);
    lines.push(`Return up to ${opts.limit} of the best-matching, genuinely-relevant currently-open roles as a JSON array. Quality over quantity — only roles that truly fit the keywords, level, and location above.`);
    return lines.join("\n");
}

interface ResolvedCompany {
    companyId: string | null;
    suggestedCompanyId: string | null;
    companyName: string;
    companyDomain: string | null;
}

/** Minimal lead row returned to the UI for live append after each pass. */
export interface InsertedLead {
    id: string;
    companyName: string;
    companyDomain: string | null;
    title: string;
    level: JobLevel;
    locationText: string | null;
    isRemote: boolean;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    matchScore: number | null;
    matchReason: string | null;
    applicationUrl: string | null;
}

/** One search pass: a saved location (or the remote pass). */
interface SearchPass {
    locationId: string | null; // null = remote pass
    target: string;
    isRemote: boolean;
    limit: number;
    /** Scope this pass to a single employer (per-company JobScan). */
    onlyCompany?: string;
    /** Attach every inserted lead directly to this tracked company, bypassing name matching. */
    forceCompanyId?: string;
}

/**
 * The ordered list of passes for a full profile search: one per enabled location,
 * plus a remote pass when allowed. Stored in JobSearchRun.params so runNextPass can
 * execute them one at a time and resume across requests.
 */
function buildPasses(
    locations: { id: string; label: string; maxResults: number }[],
    profile: { allowRemote: boolean; resultsPerLocation: number },
): SearchPass[] {
    const passes: SearchPass[] = locations.map((l) => ({
        locationId: l.id,
        target: l.label,
        isRemote: false,
        limit: Math.min(l.maxResults || profile.resultsPerLocation || DEFAULT_RESULTS_PER_PASS, DEFAULT_RESULTS_PER_PASS),
    }));
    if (profile.allowRemote) {
        passes.push({ locationId: null, target: "remote", isRemote: true, limit: Math.min(profile.resultsPerLocation || DEFAULT_RESULTS_PER_PASS, DEFAULT_RESULTS_PER_PASS) });
    }
    return passes;
}

/**
 * Resolve a company name/domain to a tracked Company or a SuggestedCompany (creating
 * the latter when the profile allows new companies). Caches resolutions per call.
 */
function makeCompanyResolver(
    userId: string,
    companies: { id: string; name: string; websiteDomain: string | null }[],
    includeNewCompanies: boolean,
) {
    const cache = new Map<string, ResolvedCompany | null>();
    return async (name: string, domain: string | null): Promise<ResolvedCompany | null> => {
        const cacheKey = (domain ? cleanDomain(domain) : name.toLowerCase()).trim();
        if (cache.has(cacheKey)) return cache.get(cacheKey)!;

        const existing = companies.find((c) => {
            if (domain && c.websiteDomain && cleanDomain(c.websiteDomain) === cleanDomain(domain)) return true;
            return c.name.toLowerCase() === name.toLowerCase();
        });
        if (existing) {
            const r: ResolvedCompany = { companyId: existing.id, suggestedCompanyId: null, companyName: existing.name, companyDomain: domain };
            cache.set(cacheKey, r);
            return r;
        }

        if (!includeNewCompanies) {
            cache.set(cacheKey, null);
            return null;
        }

        const prior = await db.suggestedCompany.findFirst({ where: { userId, name: { equals: name, mode: "insensitive" } } });
        if (prior?.status === SuggestionStatus.DISMISSED) {
            cache.set(cacheKey, null); // user rejected this company — skip its roles
            return null;
        }
        if (prior?.status === SuggestionStatus.ADDED && prior.promotedCompanyId) {
            const r: ResolvedCompany = { companyId: prior.promotedCompanyId, suggestedCompanyId: null, companyName: prior.name, companyDomain: domain };
            cache.set(cacheKey, r);
            return r;
        }
        const suggested =
            prior ??
            (await db.suggestedCompany.create({
                data: { userId, name, websiteDomain: domain ? cleanDomain(domain) : null, status: SuggestionStatus.NEW },
            }));
        const r: ResolvedCompany = { companyId: null, suggestedCompanyId: suggested.id, companyName: suggested.name, companyDomain: domain };
        cache.set(cacheKey, r);
        return r;
    };
}

/**
 * Run ONE web-search pass (Haiku) and persist the deduped NEW leads it returns.
 * `known` is mutated to include every fingerprint inserted, so subsequent passes /
 * runs never re-insert the same role. Returns the inserted rows + the AI cost.
 */
async function runOnePass(opts: {
    userId: string;
    profile: {
        profileText: string | null;
        keywords: string[];
        excludeKeywords: string[];
        levels: JobLevel[];
        distanceMiles: number;
        minSalary: number | null;
        includeNewCompanies: boolean;
    };
    pass: SearchPass;
    savedLocs: { id: string; lat: number; lon: number }[];
    resolveCompany: ReturnType<typeof makeCompanyResolver>;
    known: Set<string>;
    model: string;
    /** The user's tracked companies — scanned via their careers pages on location passes. */
    trackedCompanies?: string[];
}): Promise<{ inserted: InsertedLead[]; costUsd: number; searches: number; tokens: number }> {
    const { userId, profile, pass, savedLocs, resolveCompany, known, model, trackedCompanies } = opts;

    const { data, searchCount, costUsd: cost, inputTokens, outputTokens } = await runClaudeWithWebSearch<RawLead[]>({
        purpose: "job-search-leads",
        userId,
        model,
        system: SEARCH_SYSTEM,
        maxSearches: SEARCH_MAX_SEARCHES,
        maxTokens: SEARCH_MAX_TOKENS,
        content: buildPrompt({
            profileText: profile.profileText,
            keywords: profile.keywords,
            excludeKeywords: profile.excludeKeywords,
            levels: profile.levels,
            distanceMiles: profile.distanceMiles,
            minSalary: profile.minSalary,
            target: pass.target,
            isRemote: pass.isRemote,
            limit: pass.limit,
            onlyCompany: pass.onlyCompany,
            trackedCompanies,
        }),
    });
    const tokens = (inputTokens ?? 0) + (outputTokens ?? 0);

    const inserted: InsertedLead[] = [];
    const geocodeCache = new Map<string, { lat: number; lon: number } | null>();

    for (const raw of Array.isArray(data) ? data : []) {
        if (!raw?.title) continue;
        // For a forced (per-company) pass, attribute the role to the target company name
        // so the fingerprint/dedupe and the stored row line up with that company.
        const effectiveCompanyName = pass.forceCompanyId ? pass.onlyCompany ?? raw.companyName : raw.companyName;
        if (!effectiveCompanyName) continue;
        const key = fingerprint({ companyName: effectiveCompanyName, title: raw.title, locationText: raw.locationText, applicationUrl: raw.applicationUrl });
        if (known.has(key)) continue; // already present across passes / runs
        known.add(key);

        // forceCompanyId attaches directly to the tracked company, bypassing name matching.
        const resolved: ResolvedCompany | null = pass.forceCompanyId
            ? { companyId: pass.forceCompanyId, suggestedCompanyId: null, companyName: effectiveCompanyName, companyDomain: raw.companyDomain ?? null }
            : await resolveCompany(raw.companyName!.trim(), raw.companyDomain ?? null);
        if (!resolved) continue;

        let place: { lat: number; lon: number } | null = null;
        if (!raw.isRemote && raw.locationText) {
            const pk = raw.locationText.trim();
            if (geocodeCache.has(pk)) {
                place = geocodeCache.get(pk)!;
            } else {
                const pt = await geocodeQuery(pk);
                place = pt ? { lat: pt.lat, lon: pt.lon } : null;
                geocodeCache.set(pk, place);
            }
        }

        let nearestLocationId: string | null = null;
        let distanceMiles: number | null = null;
        if (place && savedLocs.length) {
            const near = nearestLocation(place, savedLocs);
            if (near) {
                nearestLocationId = near.location.id;
                distanceMiles = Math.round(near.miles * 10) / 10;
            }
        }

        const lead = await db.jobLead.create({
            data: {
                userId,
                companyId: resolved.companyId,
                suggestedCompanyId: resolved.suggestedCompanyId,
                companyName: resolved.companyName,
                companyDomain: resolved.companyDomain ? cleanDomain(resolved.companyDomain) : null,
                title: raw.title.trim(),
                level: normLevel(raw.level),
                descriptionSnippet: raw.descriptionSnippet?.slice(0, 500) ?? null,
                applicationUrl: raw.applicationUrl ?? null,
                salaryMin: typeof raw.salaryMin === "number" ? Math.round(raw.salaryMin) : null,
                salaryMax: typeof raw.salaryMax === "number" ? Math.round(raw.salaryMax) : null,
                salaryCurrency: raw.salaryCurrency ?? "USD",
                deadline: parseDeadline(raw.deadline),
                locationText: raw.locationText?.trim() ?? null,
                lat: place?.lat ?? null,
                lon: place?.lon ?? null,
                isRemote: Boolean(raw.isRemote),
                nearestLocationId,
                distanceMiles,
                matchScore: typeof raw.matchScore === "number" ? Math.max(0, Math.min(100, Math.round(raw.matchScore))) : null,
                matchReason: raw.matchReason?.slice(0, 300) ?? null,
                status: SuggestionStatus.NEW,
            },
            select: {
                id: true,
                companyName: true,
                companyDomain: true,
                title: true,
                level: true,
                locationText: true,
                isRemote: true,
                salaryMin: true,
                salaryMax: true,
                salaryCurrency: true,
                matchScore: true,
                matchReason: true,
                applicationUrl: true,
            },
        });
        inserted.push(lead);
    }

    return { inserted, costUsd: cost, searches: searchCount, tokens };
}

/**
 * Full profile search (legacy entry, kept working): creates a run and loops every
 * pass server-side, merging genuinely-new deduped roles into the existing NEW leads.
 * The UI normally drives runNextPass instead, for live progress + halt.
 */
export async function generateLeads(): Promise<{ found: number; searches: number }> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const { runId, totalPasses } = await startJobSearchRun();
    let found = 0;
    let searches = 0;
    for (let i = 0; i < totalPasses; i++) {
        const res = await runNextPass(runId);
        if (res.error) throw new Error(res.error);
        found = res.totalFound ?? found;
        searches += res.searchesThisPass ?? 0;
        if (res.done || res.cancelled || res.budgetExceeded) break;
    }
    revalidateSearch();
    return { found, searches };
}

/**
 * Search every tracked company for current openings around the saved locations (or
 * remote), using the saved job-search settings. Refreshes the NEW leads attached to
 * tracked companies; suggested-company leads and ADDED/DISMISSED ones are left alone.
 */
export async function generateLeadsForExistingCompanies(): Promise<{ found: number; companies: number; searches: number }> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const [profile, locations, companies, settings] = await Promise.all([
        getOrCreateProfile(user.id),
        db.jobSearchLocation.findMany({ where: { userId: user.id, enabled: true }, orderBy: { priority: "asc" } }),
        db.company.findMany({ where: { userId: user.id }, select: { id: true, name: true, websiteDomain: true } }),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);

    if (companies.length === 0) throw new Error("You don't have any companies yet — add a company first, or run the full job search.");
    if (locations.length === 0 && !profile.allowRemote) {
        throw new Error("Add at least one search location, or enable remote roles in the search settings.");
    }

    const locationLabels = locations.map((l) => l.label);
    const savedLocs = locations.map((l) => ({ id: l.id, lat: l.lat, lon: l.lon }));
    const remoteOnly = locationLabels.length === 0 && profile.allowRemote;
    const model = searchModel(settings);

    // Refresh NEW leads for tracked companies only — back them up first (never hard-delete).
    await softDeleteNewLeadsWhere(user.id, { companyId: { in: companies.map((c) => c.id) } });

    // Dedup against everything the user already knows (incl. the just-backed-up rows).
    const known = await loadKnownFingerprints(user.id);

    const placeCache = new Map<string, { lat: number; lon: number } | null>();
    const geocodePlace = async (text: string) => {
        const key = text.trim();
        if (placeCache.has(key)) return placeCache.get(key)!;
        const pt = await geocodeQuery(key);
        const v = pt ? { lat: pt.lat, lon: pt.lon } : null;
        placeCache.set(key, v);
        return v;
    };

    let created = 0;
    let searchCount = 0;
    for (const company of companies) {
        try {
            const { data, searchCount: n } = await runClaudeWithWebSearch<RawLead[]>({
                purpose: "job-search-existing-companies",
                userId: user.id,
                model,
                system: SEARCH_SYSTEM,
                maxSearches: SEARCH_MAX_SEARCHES,
                maxTokens: SEARCH_MAX_TOKENS,
                content: buildPrompt({
                    profileText: profile.profileText,
                    keywords: profile.keywords,
                    excludeKeywords: profile.excludeKeywords,
                    levels: profile.levels,
                    distanceMiles: profile.distanceMiles,
                    minSalary: profile.minSalary,
                    target: locationLabels[0] ?? "United States",
                    locations: locationLabels,
                    allowRemote: profile.allowRemote,
                    isRemote: remoteOnly,
                    limit: DEFAULT_RESULTS_PER_PASS,
                    onlyCompany: company.name,
                }),
            });
            searchCount += n;

            for (const raw of Array.isArray(data) ? data : []) {
                if (!raw?.title) continue;
                if (raw.isRemote && !profile.allowRemote) continue; // respect the remote setting
                const key = fingerprint({ applicationUrl: raw.applicationUrl, companyName: company.name, title: raw.title, locationText: raw.locationText });
                if (known.has(key)) continue;
                known.add(key);

                const place = !raw.isRemote && raw.locationText ? await geocodePlace(raw.locationText.trim()) : null;
                let nearestLocationId: string | null = null;
                let distanceMiles: number | null = null;
                if (place && savedLocs.length) {
                    const near = nearestLocation(place, savedLocs);
                    if (near) {
                        nearestLocationId = near.location.id;
                        distanceMiles = Math.round(near.miles * 10) / 10;
                    }
                }

                await db.jobLead.create({
                    data: {
                        userId: user.id,
                        companyId: company.id,
                        companyName: company.name,
                        companyDomain: company.websiteDomain ? cleanDomain(company.websiteDomain) : raw.companyDomain ? cleanDomain(raw.companyDomain) : null,
                        title: raw.title.trim(),
                        level: normLevel(raw.level),
                        descriptionSnippet: raw.descriptionSnippet?.slice(0, 500) ?? null,
                        applicationUrl: raw.applicationUrl ?? null,
                        salaryMin: typeof raw.salaryMin === "number" ? Math.round(raw.salaryMin) : null,
                        salaryMax: typeof raw.salaryMax === "number" ? Math.round(raw.salaryMax) : null,
                        salaryCurrency: raw.salaryCurrency ?? "USD",
                        deadline: parseDeadline(raw.deadline),
                        locationText: raw.locationText?.trim() ?? null,
                        lat: place?.lat ?? null,
                        lon: place?.lon ?? null,
                        isRemote: Boolean(raw.isRemote),
                        nearestLocationId,
                        distanceMiles,
                        matchScore: typeof raw.matchScore === "number" ? Math.max(0, Math.min(100, Math.round(raw.matchScore))) : null,
                        matchReason: raw.matchReason?.slice(0, 300) ?? null,
                        status: SuggestionStatus.NEW,
                    },
                });
                created++;
            }
        } catch {
            // One company's failed pass shouldn't abort the whole run.
            continue;
        }
    }

    revalidateSearch();
    return { found: created, companies: companies.length, searches: searchCount };
}

/** Re-run the search for a single tracked company (used on the company page). */
export async function regenerateCompanyLeads(fd: FormData): Promise<{ found: number }> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");
    const companyId = String(fd.get("companyId"));
    const company = await db.company.findFirst({ where: { id: companyId, userId: user.id } });
    if (!company) throw new Error("Company not found");

    const [profile, locations, settings] = await Promise.all([
        getOrCreateProfile(user.id),
        db.jobSearchLocation.findMany({ where: { userId: user.id, enabled: true }, orderBy: { priority: "asc" } }),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);

    // Use the saved job-search settings: search across every saved location (or remote).
    const locationLabels = locations.map((l) => l.label);
    const remoteOnly = locationLabels.length === 0 && profile.allowRemote;
    const { data } = await runClaudeWithWebSearch<RawLead[]>({
        purpose: "job-search-company",
        userId: user.id,
        model: searchModel(settings),
        system: SEARCH_SYSTEM,
        maxSearches: SEARCH_MAX_SEARCHES,
        maxTokens: SEARCH_MAX_TOKENS,
        content: buildPrompt({
            profileText: profile.profileText,
            keywords: profile.keywords,
            excludeKeywords: profile.excludeKeywords,
            levels: profile.levels,
            distanceMiles: profile.distanceMiles,
            minSalary: profile.minSalary,
            target: locationLabels[0] ?? "United States",
            locations: locationLabels,
            allowRemote: profile.allowRemote,
            isRemote: remoteOnly,
            limit: DEFAULT_RESULTS_PER_PASS,
            onlyCompany: company.name,
        }),
    });

    // Replace this company's NEW leads only — back them up first (never hard-delete).
    await softDeleteNewLeadsWhere(user.id, { companyId });

    // Dedup against everything the user already knows.
    const known = await loadKnownFingerprints(user.id);

    const savedLocs = locations.map((l) => ({ id: l.id, lat: l.lat, lon: l.lon }));
    let created = 0;
    for (const raw of Array.isArray(data) ? data : []) {
        if (!raw?.title) continue;
        const dkey = fingerprint({ applicationUrl: raw.applicationUrl, companyName: company.name, title: raw.title, locationText: raw.locationText });
        if (known.has(dkey)) continue;
        known.add(dkey);
        const place = !raw.isRemote && raw.locationText ? await geocodeQuery(raw.locationText.trim()) : null;
        let nearestLocationId: string | null = null;
        let distanceMiles: number | null = null;
        if (place && savedLocs.length) {
            const near = nearestLocation({ lat: place.lat, lon: place.lon }, savedLocs);
            if (near) {
                nearestLocationId = near.location.id;
                distanceMiles = Math.round(near.miles * 10) / 10;
            }
        }
        await db.jobLead.create({
            data: {
                userId: user.id,
                companyId,
                companyName: company.name,
                companyDomain: company.websiteDomain ? cleanDomain(company.websiteDomain) : raw.companyDomain ? cleanDomain(raw.companyDomain) : null,
                title: raw.title.trim(),
                level: normLevel(raw.level),
                descriptionSnippet: raw.descriptionSnippet?.slice(0, 500) ?? null,
                applicationUrl: raw.applicationUrl ?? null,
                salaryMin: typeof raw.salaryMin === "number" ? Math.round(raw.salaryMin) : null,
                salaryMax: typeof raw.salaryMax === "number" ? Math.round(raw.salaryMax) : null,
                salaryCurrency: raw.salaryCurrency ?? "USD",
                deadline: parseDeadline(raw.deadline),
                locationText: raw.locationText?.trim() ?? null,
                lat: place?.lat ?? null,
                lon: place?.lon ?? null,
                isRemote: Boolean(raw.isRemote),
                nearestLocationId,
                distanceMiles,
                matchScore: typeof raw.matchScore === "number" ? Math.max(0, Math.min(100, Math.round(raw.matchScore))) : null,
                matchReason: raw.matchReason?.slice(0, 300) ?? null,
                status: SuggestionStatus.NEW,
            },
        });
        created++;
    }

    revalidateSearch(companyId);
    return { found: created };
}

// ------------------------------------------------------------------
// Live, client-driven run model: estimate · start · runNextPass · halt
// ------------------------------------------------------------------

// Rough per-call cost model for ESTIMATES ONLY (Haiku $1/$5 per MTok + web search
// $0.01/search). Actual cost is whatever runClaudeWithWebSearch reports per call.
const EST_INPUT_PER_MTOK = 1; // Haiku input $/1M
const EST_OUTPUT_PER_MTOK = 5; // Haiku output $/1M
const EST_WEB_SEARCH_COST = 0.01; // $/search
const EST_INPUT_TOKENS = 2500; // typical prompt + tool overhead per pass
const EST_OUTPUT_TOKENS = 3000; // realistic: ~10-30 dense role objects, not the full token cap
const DEFAULT_EST_YIELD_PER_PASS = 10; // first-run guess for NEW deduped roles/pass (history overrides this)

/** Estimated cost of a single Haiku web-search pass. */
function estimatePassCostUsd(): number {
    const tokenCost = (EST_INPUT_TOKENS * EST_INPUT_PER_MTOK + EST_OUTPUT_TOKENS * EST_OUTPUT_PER_MTOK) / 1_000_000;
    return tokenCost + SEARCH_MAX_SEARCHES * EST_WEB_SEARCH_COST;
}

/**
 * Expected NEW (deduped) roles per pass. Learns from the user's recent finished runs —
 * total roles found ÷ passes actually run — so the estimate tracks reality instead of a
 * fixed guess (which made "~270 roles for $1" wildly overstate a run that found 5).
 */
async function expectedYieldPerPass(userId: string): Promise<number> {
    const recent = await db.jobSearchRun.findMany({
        where: { userId, status: { in: ["done", "cancelled"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { foundCount: true, progress: true, params: true },
    });
    let found = 0;
    let passesRun = 0;
    for (const r of recent) {
        const fromProgress = (r.progress as { passesDone?: number } | null)?.passesDone;
        const fromParams = (r.params as { passesDone?: number } | null)?.passesDone;
        const pd = typeof fromProgress === "number" ? fromProgress : typeof fromParams === "number" ? fromParams : 0;
        if (pd > 0) {
            found += r.foundCount;
            passesRun += pd;
        }
    }
    if (passesRun >= 2) {
        // Clamp so one fluke run can't wildly swing the preview; keep it honest and bounded.
        return Math.max(0.3, Math.min(40, found / passesRun));
    }
    return DEFAULT_EST_YIELD_PER_PASS;
}

export interface JobSearchEstimate {
    estimatedResults: number;
    estimatedCostUsd: number;
    passes: number;
}

/** Shared estimate: passes × (historical) yield for count, passes × per-pass cost for $. */
async function computeEstimate(userId: string, passesCount: number): Promise<JobSearchEstimate> {
    const yieldPerPass = await expectedYieldPerPass(userId);
    return {
        passes: passesCount,
        estimatedResults: Math.max(passesCount > 0 ? 1 : 0, Math.round(passesCount * yieldPerPass)),
        estimatedCostUsd: Math.round(passesCount * estimatePassCostUsd() * 1_000_000) / 1_000_000,
    };
}

/** Shape stored in JobSearchRun.params. */
interface RunParams {
    passes: SearchPass[];
    passesDone: number;
}

function runParams(run: { params: Prisma.JsonValue | null }): RunParams {
    const p = (run.params ?? {}) as Partial<RunParams>;
    return { passes: Array.isArray(p.passes) ? (p.passes as SearchPass[]) : [], passesDone: typeof p.passesDone === "number" ? p.passesDone : 0 };
}

/**
 * Pure, cheap estimate (no AI call): one pass per enabled location, plus a remote
 * pass when allowed. Cost is per-pass Haiku cost × passes; results are passes × an
 * expected deduped yield. Used by the UI to preview cost before starting a run.
 */
export async function estimateJobSearch(): Promise<JobSearchEstimate> {
    const user = await requireUser();
    const [profile, locations] = await Promise.all([
        getOrCreateProfile(user.id),
        db.jobSearchLocation.findMany({ where: { userId: user.id, enabled: true }, orderBy: { priority: "asc" }, select: { id: true, label: true, maxResults: true } }),
    ]);
    const passes = buildPasses(locations, profile);
    return computeEstimate(user.id, passes.length);
}

export interface StartRunResult {
    runId: string;
    totalPasses: number;
    estimate: JobSearchEstimate;
}

/**
 * Create a JobSearchRun (status 'running') with the ordered list of passes baked into
 * params, so the client can drive it one pass at a time via runNextPass.
 */
export async function startJobSearchRun(): Promise<StartRunResult> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const [profile, locations] = await Promise.all([
        getOrCreateProfile(user.id),
        db.jobSearchLocation.findMany({ where: { userId: user.id, enabled: true }, orderBy: { priority: "asc" }, select: { id: true, label: true, maxResults: true } }),
    ]);
    if (locations.length === 0 && !profile.allowRemote) {
        throw new Error("Add at least one search location, or enable remote roles in the search settings.");
    }

    const passes = buildPasses(locations, profile);
    const estimate = await computeEstimate(user.id, passes.length);

    const params: RunParams = { passes, passesDone: 0 };
    const run = await db.jobSearchRun.create({
        data: {
            userId: user.id,
            status: "running",
            startedAt: new Date(),
            targetCount: estimate.estimatedResults,
            estimatedCostUsd: estimate.estimatedCostUsd,
            params: params as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
    });

    return { runId: run.id, totalPasses: passes.length, estimate };
}

/**
 * Start a company-scoped AI JobScan: one pass per ENABLED search location (each scoped to
 * the given company via onlyCompany + forceCompanyId so inserted leads attach to THIS
 * company), plus a remote pass when the profile allows it. Reuses the same client-driven
 * run model (runNextPass / cancelJobSearchRun / getJobSearchRun) and the same dedupe, so
 * results never duplicate existing leads / applications / backed-up roles.
 *
 * Falls back to a single consolidated pass (onlyCompany + forceCompanyId, target = company
 * name) when the user has no enabled locations and remote is off.
 */
export async function startCompanyJobScan(companyId: string): Promise<StartRunResult> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const [company, profile, locations] = await Promise.all([
        db.company.findFirst({ where: { id: companyId, userId: user.id }, select: { id: true, name: true } }),
        getOrCreateProfile(user.id),
        db.jobSearchLocation.findMany({
            where: { userId: user.id, enabled: true },
            orderBy: { priority: "asc" },
            select: { id: true, label: true, maxResults: true },
        }),
    ]);
    if (!company) throw new Error("Company not found");

    const perPassLimit = Math.min(profile.resultsPerLocation || DEFAULT_RESULTS_PER_PASS, DEFAULT_RESULTS_PER_PASS);

    let passes: SearchPass[] = locations.map((l) => ({
        locationId: l.id,
        target: l.label,
        isRemote: false,
        limit: Math.min(l.maxResults || profile.resultsPerLocation || DEFAULT_RESULTS_PER_PASS, DEFAULT_RESULTS_PER_PASS),
        onlyCompany: company.name,
        forceCompanyId: company.id,
    }));
    if (profile.allowRemote) {
        passes.push({
            locationId: null,
            target: "remote",
            isRemote: true,
            limit: perPassLimit,
            onlyCompany: company.name,
            forceCompanyId: company.id,
        });
    }
    // No enabled locations and remote off → one consolidated pass targeting the company name.
    if (passes.length === 0) {
        passes = [
            {
                locationId: null,
                target: company.name,
                isRemote: false,
                limit: perPassLimit,
                onlyCompany: company.name,
                forceCompanyId: company.id,
            },
        ];
    }

    const estimate = await computeEstimate(user.id, passes.length);
    const params: RunParams = { passes, passesDone: 0 };
    const run = await db.jobSearchRun.create({
        data: {
            userId: user.id,
            status: "running",
            startedAt: new Date(),
            targetCount: estimate.estimatedResults,
            estimatedCostUsd: estimate.estimatedCostUsd,
            params: params as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
    });

    return { runId: run.id, totalPasses: passes.length, estimate };
}

/**
 * The given company's current NEW JobLeads (status NEW, companyId = that company), mapped
 * to InsertedLead and newest first — so the company page can list its AI-suggested roles
 * and refresh after a JobScan run.
 */
export async function getCompanyScanLeads(companyId: string): Promise<InsertedLead[]> {
    const user = await requireUser();
    const company = await db.company.findFirst({ where: { id: companyId, userId: user.id }, select: { id: true } });
    if (!company) throw new Error("Company not found");

    return db.jobLead.findMany({
        where: { userId: user.id, companyId, status: SuggestionStatus.NEW },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            companyName: true,
            companyDomain: true,
            title: true,
            level: true,
            locationText: true,
            isRemote: true,
            salaryMin: true,
            salaryMax: true,
            salaryCurrency: true,
            matchScore: true,
            matchReason: true,
            applicationUrl: true,
        },
    });
}

export interface RunNextPassResult {
    done: boolean;
    cancelled: boolean;
    budgetExceeded: boolean;
    passesDone: number;
    totalPasses: number;
    foundThisPass: number;
    totalFound: number;
    costSoFar: number;
    searchesThisPass?: number;
    /** Tokens (input + output) used by this pass's AI call; 0 on a skipped/failed pass. */
    tokensThisPass: number;
    /** Cumulative tokens used by the whole run so far. */
    totalTokens: number;
    newLeads: InsertedLead[];
    error?: string;
    /** True when the error is unrecoverable (AI disabled / budget / auth) and the whole run should stop. */
    fatal?: boolean;
}

/**
 * Execute the NEXT not-yet-done pass for a run: exactly ONE Haiku web-search call,
 * deduped insert, and run-counter updates. Honors cancel + per-search budget. The
 * client calls this repeatedly until done/cancelled/budgetExceeded.
 */
export async function runNextPass(runId: string): Promise<RunNextPassResult> {
    const user = await requireUser();

    const run = await db.jobSearchRun.findFirst({ where: { id: runId, userId: user.id } });
    if (!run) throw new Error("Run not found");

    const { passes, passesDone } = runParams(run);
    const totalPasses = passes.length;
    const priorTokens = runProgressTokens(run);
    const base = {
        passesDone,
        totalPasses,
        foundThisPass: 0,
        totalFound: run.foundCount,
        costSoFar: Number(run.actualCostUsd),
        tokensThisPass: 0,
        totalTokens: priorTokens,
        newLeads: [] as InsertedLead[],
    };

    // Already-terminal run.
    if (run.status === "done" || run.status === "cancelled" || run.status === "error") {
        return { ...base, done: run.status === "done", cancelled: run.status === "cancelled", budgetExceeded: false, error: run.error ?? undefined };
    }

    // Cancellation takes priority — check before spending anything.
    if (run.cancelRequested) {
        await db.jobSearchRun.update({ where: { id: run.id }, data: { status: "cancelled", finishedAt: new Date() } });
        return { ...base, done: false, cancelled: true, budgetExceeded: false };
    }

    // Nothing left to do → finalize as done.
    if (passesDone >= totalPasses) {
        await db.jobSearchRun.update({ where: { id: run.id }, data: { status: "done", finishedAt: new Date() } });
        return { ...base, done: true, cancelled: false, budgetExceeded: false };
    }

    // Load context for this pass.
    const [profile, locations, companies, settings] = await Promise.all([
        getOrCreateProfile(user.id),
        db.jobSearchLocation.findMany({ where: { userId: user.id, enabled: true }, select: { id: true, lat: true, lon: true } }),
        db.company.findMany({ where: { userId: user.id }, select: { id: true, name: true, websiteDomain: true } }),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);

    // Per-search hard budget: stop before spending if we've already reached it.
    const perSearchLimit = settings?.aiPerSearchLimitUsd != null ? Number(settings.aiPerSearchLimitUsd) : null;
    if (perSearchLimit != null && Number.isFinite(perSearchLimit) && Number(run.actualCostUsd) >= perSearchLimit) {
        await db.jobSearchRun.update({ where: { id: run.id }, data: { status: "done", finishedAt: new Date() } });
        return { ...base, done: true, cancelled: false, budgetExceeded: true };
    }

    const pass = passes[passesDone];
    const savedLocs = locations.map((l) => ({ id: l.id, lat: l.lat, lon: l.lon }));
    const resolveCompany = makeCompanyResolver(user.id, companies, profile.includeNewCompanies);
    const known = await loadKnownFingerprints(user.id);

    const nextDone = passesDone + 1;
    const isLast = nextDone >= totalPasses;

    // Run this pass with one retry for transient failures (parse hiccup, network, overloaded).
    // A pass that ultimately fails is SKIPPED — we advance and let the run continue — so one
    // bad location can never stall the whole search. Fatal errors (AI off / budget / auth) stop it.
    let passResult: { inserted: InsertedLead[]; costUsd: number; searches: number; tokens: number } | null = null;
    let passError: string | null = null;
    for (let attempt = 0; attempt < 2 && passResult == null; attempt++) {
        try {
            passResult = await runOnePass({
                userId: user.id,
                profile: {
                    profileText: profile.profileText,
                    keywords: profile.keywords,
                    excludeKeywords: profile.excludeKeywords,
                    levels: profile.levels,
                    distanceMiles: profile.distanceMiles,
                    minSalary: profile.minSalary,
                    includeNewCompanies: profile.includeNewCompanies,
                },
                pass,
                savedLocs,
                resolveCompany,
                known,
                model: searchModel(settings),
                // Location passes also scan the user's tracked companies' careers pages.
                // (buildPrompt ignores this when the pass is scoped to a single onlyCompany.)
                trackedCompanies: companies.slice(0, 30).map((c) => c.name),
            });
        } catch (error) {
            passError = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
            // Unrecoverable — retrying or skipping won't help; stop the whole run.
            if (/disabled|budget|api key|unauthorized|invalid x-api-key|\b401\b|\b403\b/i.test(passError)) {
                await db.jobSearchRun.update({ where: { id: run.id }, data: { status: "error", error: passError, finishedAt: new Date() } });
                return { ...base, done: false, cancelled: false, budgetExceeded: false, error: passError, fatal: true };
            }
            // else: loop retries once, then falls through to skip-and-continue below.
        }
    }

    // Pass failed after retries → record the error, advance, and keep going (skip this pass).
    if (passResult == null) {
        const errors = [...runProgressErrors(run), { pass: passesDone + 1, message: passError ?? "Unknown error" }].slice(-10);
        await db.jobSearchRun.update({
            where: { id: run.id },
            data: {
                error: passError,
                params: { passes, passesDone: nextDone } as unknown as Prisma.InputJsonValue,
                progress: { passesDone: nextDone, totalPasses, errors, tokensUsed: priorTokens } as unknown as Prisma.InputJsonValue,
                ...(isLast ? { status: "done", finishedAt: new Date() } : {}),
            },
        });
        revalidateSearch();
        return {
            ...base,
            done: isLast,
            cancelled: false,
            budgetExceeded: false,
            passesDone: nextDone,
            error: passError ?? undefined,
        };
    }

    const { inserted, costUsd: passCost, searches, tokens: passTokens } = passResult;
    const newParams: RunParams = { passes, passesDone: nextDone };
    const newCost = Number(run.actualCostUsd) + passCost;
    const newFound = run.foundCount + inserted.length;
    const newTokens = priorTokens + passTokens;

    // After spending, re-evaluate cancel + budget to decide whether to finalize.
    const fresh = await db.jobSearchRun.findUnique({ where: { id: run.id }, select: { cancelRequested: true } });
    const cancelledNow = fresh?.cancelRequested ?? false;
    const budgetHitNow = perSearchLimit != null && Number.isFinite(perSearchLimit) && newCost >= perSearchLimit;
    const finalize = isLast || cancelledNow || budgetHitNow;
    const finalStatus = cancelledNow ? "cancelled" : "done";

    await db.jobSearchRun.update({
        where: { id: run.id },
        data: {
            foundCount: newFound,
            actualCostUsd: newCost,
            params: newParams as unknown as Prisma.InputJsonValue,
            progress: { passesDone: nextDone, totalPasses, errors: runProgressErrors(run), tokensUsed: newTokens } as unknown as Prisma.InputJsonValue,
            ...(finalize ? { status: finalStatus, finishedAt: new Date() } : {}),
        },
    });

    revalidateSearch();
    return {
        done: finalize && !cancelledNow,
        cancelled: cancelledNow,
        budgetExceeded: budgetHitNow,
        passesDone: nextDone,
        totalPasses,
        foundThisPass: inserted.length,
        totalFound: newFound,
        costSoFar: newCost,
        searchesThisPass: searches,
        tokensThisPass: passTokens,
        totalTokens: newTokens,
        newLeads: inserted,
    };
}

/**
 * Request cancellation of a run. The next runNextPass sees this and stops before any
 * further AI spend; if no pass is currently executing, mark it cancelled immediately.
 */
export async function cancelJobSearchRun(runId: string): Promise<{ cancelled: boolean }> {
    const user = await requireUser();
    const run = await db.jobSearchRun.findFirst({ where: { id: runId, userId: user.id }, select: { id: true, status: true } });
    if (!run) throw new Error("Run not found");

    if (run.status === "done" || run.status === "cancelled" || run.status === "error") {
        return { cancelled: run.status === "cancelled" };
    }

    await db.jobSearchRun.update({
        where: { id: run.id },
        data: {
            cancelRequested: true,
            // If it's idle between passes (status 'queued'), mark cancelled now.
            ...(run.status === "queued" ? { status: "cancelled", finishedAt: new Date() } : {}),
        },
    });
    return { cancelled: true };
}

/** Fetch a single run's status/progress for polling + the AI-activity widget. */
export async function getJobSearchRun(runId: string) {
    const user = await requireUser();
    const run = await db.jobSearchRun.findFirst({ where: { id: runId, userId: user.id } });
    if (!run) return null;
    return {
        id: run.id,
        status: run.status,
        targetCount: run.targetCount,
        foundCount: run.foundCount,
        estimatedCostUsd: Number(run.estimatedCostUsd),
        actualCostUsd: Number(run.actualCostUsd),
        tokensUsed: runProgressTokens(run),
        cancelRequested: run.cancelRequested,
        progress: run.progress,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
    };
}

/** All currently-active (queued or running) runs for the AI-activity widget. */
export async function listActiveJobSearchRuns() {
    const user = await requireUser();
    const runs = await db.jobSearchRun.findMany({
        where: { userId: user.id, status: { in: ["queued", "running"] } },
        orderBy: { createdAt: "desc" },
    });
    return runs.map((run) => ({
        id: run.id,
        status: run.status,
        targetCount: run.targetCount,
        foundCount: run.foundCount,
        estimatedCostUsd: Number(run.estimatedCostUsd),
        actualCostUsd: Number(run.actualCostUsd),
        cancelRequested: run.cancelRequested,
        progress: run.progress,
        startedAt: run.startedAt,
        createdAt: run.createdAt,
    }));
}

// ------------------------------------------------------------------
// Promote / dismiss
// ------------------------------------------------------------------

/** Ensure a lead has a real Company to attach to, promoting its suggested company. */
async function ensureRealCompany(userId: string, leadId: string): Promise<string> {
    const lead = await db.jobLead.findFirst({ where: { id: leadId, userId }, include: { suggestedCompany: true } });
    if (!lead) throw new Error("Lead not found");
    if (lead.companyId) return lead.companyId;

    if (lead.suggestedCompany) {
        const sc = lead.suggestedCompany;
        if (sc.promotedCompanyId) return sc.promotedCompanyId;
        const company = await promoteSuggestedCompanyRecord(userId, sc.id);
        return company.id;
    }

    // No company link at all: reuse an existing tracked company by domain or name
    // before creating a new one, so we don't end up with duplicate companies.
    const domain = lead.companyDomain ? cleanDomain(lead.companyDomain) : null;
    const existing = await db.company.findFirst({
        where: {
            userId,
            OR: [...(domain ? [{ websiteDomain: domain }] : []), { name: { equals: lead.companyName, mode: "insensitive" as const } }],
        },
        select: { id: true },
    });
    const company =
        existing ??
        (await db.company.create({
            data: { userId, name: lead.companyName, websiteDomain: domain },
        }));
    await db.jobLead.update({ where: { id: leadId }, data: { companyId: company.id } });
    return company.id;
}

/** Create a real Company from a SuggestedCompany and re-link its leads. */
async function promoteSuggestedCompanyRecord(userId: string, suggestedCompanyId: string) {
    const sc = await db.suggestedCompany.findFirst({ where: { id: suggestedCompanyId, userId } });
    if (!sc) throw new Error("Suggested company not found");
    if (sc.promotedCompanyId) {
        const existing = await db.company.findUnique({ where: { id: sc.promotedCompanyId } });
        if (existing) return existing;
    }
    const company = await db.company.create({
        data: {
            userId,
            name: sc.name,
            websiteDomain: sc.websiteDomain,
            logoKey: sc.logoKey,
            industry: sc.industry,
            hqLocation: sc.hqLocation,
            size: sc.size,
        },
    });
    await db.suggestedCompany.update({ where: { id: sc.id }, data: { status: SuggestionStatus.ADDED, promotedCompanyId: company.id } });
    // Re-point its leads at the real company so they render on the company page.
    await db.jobLead.updateMany({ where: { suggestedCompanyId: sc.id, status: SuggestionStatus.NEW }, data: { companyId: company.id } });
    return company;
}

/** Add a tracked company from an AI suggestion (so it joins your Companies list). */
export async function addSuggestedCompany(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const company = await promoteSuggestedCompanyRecord(user.id, id);
    revalidateSearch(company.id);
}

export async function dismissSuggestedCompany(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const sc = await db.suggestedCompany.findFirst({ where: { id, userId: user.id } });
    if (!sc) throw new Error("Suggested company not found");
    await db.suggestedCompany.update({ where: { id }, data: { status: SuggestionStatus.DISMISSED } });
    // Remove its still-NEW leads so they leave the suggestions list — back them up first.
    await softDeleteNewLeadsWhere(user.id, { suggestedCompanyId: id });
    revalidateSearch();
}

/** Promote an AI lead into a real JobApplication (status NOT_STARTED). */
export async function addLeadToApplications(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const lead = await db.jobLead.findFirst({ where: { id, userId: user.id } });
    if (!lead) throw new Error("Lead not found");
    if (lead.status === SuggestionStatus.ADDED && lead.promotedApplicationId) return; // already added

    const companyId = await ensureRealCompany(user.id, id);

    // Dedup: don't create a second application for the same company + role + location.
    const existingApp = await db.jobApplication.findFirst({
        where: {
            userId: user.id,
            companyId,
            role: { equals: lead.title, mode: "insensitive" },
            location: lead.locationText ?? null,
        },
        select: { id: true },
    });
    if (existingApp) {
        // Link the lead to the existing application instead of duplicating.
        await db.jobLead.update({ where: { id }, data: { status: SuggestionStatus.ADDED, promotedApplicationId: existingApp.id } });
        revalidateSearch(companyId);
        return;
    }

    const currentPhase = await db.jobPhase.findFirst({
        where: { userId: user.id, archived: false },
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true },
    });

    const app = await db.jobApplication.create({
        data: {
            userId: user.id,
            companyId,
            role: lead.title,
            applicationUrl: lead.applicationUrl,
            status: JobStatus.NOT_STARTED,
            salaryMin: lead.salaryMin,
            salaryMax: lead.salaryMax,
            salaryCurrency: lead.salaryCurrency ?? "USD",
            location: lead.locationText,
            workType: lead.isRemote ? WorkType.REMOTE : WorkType.NA,
            deadline: lead.deadline,
            nearestLocationId: lead.nearestLocationId,
            distanceMiles: lead.distanceMiles,
            phaseId: currentPhase?.id ?? null,
        },
    });
    await db.jobApplicationEvent.create({
        data: { applicationId: app.id, type: "created", message: "Added from AI suggestions", toStatus: JobStatus.NOT_STARTED },
    });
    await db.jobLead.update({ where: { id }, data: { status: SuggestionStatus.ADDED, promotedApplicationId: app.id } });

    revalidateSearch(companyId);
}

export async function dismissLead(fd: FormData) {
    const user = await requireUser();
    const id = String(fd.get("id"));
    const lead = await db.jobLead.findFirst({ where: { id, userId: user.id }, select: { ...BACKUP_SELECT, companyId: true } });
    if (!lead) throw new Error("Lead not found");
    // Never hard-delete: back the lead up into DeletedSuggestedRole, then remove it.
    await softDeleteLeads(user.id, [lead]);
    revalidateSearch(lead.companyId ?? undefined);
}

// ------------------------------------------------------------------
// Deleted-roles backup: restore / list / purge (the ONLY hard delete)
// ------------------------------------------------------------------

/** Recreate a JobLead (status NEW) from a backup row, then remove the backup. */
export async function restoreDeletedRole(id: string): Promise<{ restoredId: string }> {
    const user = await requireUser();
    const row = await db.deletedSuggestedRole.findFirst({ where: { id, userId: user.id } });
    if (!row) throw new Error("Deleted role not found");

    const lead = await db.jobLead.create({
        data: {
            userId: user.id,
            companyName: row.companyName,
            companyDomain: row.companyDomain,
            title: row.title,
            level: normLevel(row.level),
            descriptionSnippet: row.descriptionSnippet,
            applicationUrl: row.applicationUrl,
            salaryMin: row.salaryMin,
            salaryMax: row.salaryMax,
            salaryCurrency: row.salaryCurrency ?? "USD",
            locationText: row.locationText,
            lat: row.lat,
            lon: row.lon,
            isRemote: row.isRemote,
            matchScore: row.matchScore,
            matchReason: row.matchReason,
            status: SuggestionStatus.NEW,
        },
        select: { id: true },
    });
    await db.deletedSuggestedRole.delete({ where: { id: row.id } });
    revalidateSearch();
    return { restoredId: lead.id };
}

/** List the user's backed-up (removed) suggested roles, newest first. */
export async function listDeletedRoles() {
    const user = await requireUser();
    return db.deletedSuggestedRole.findMany({
        where: { userId: user.id },
        orderBy: { deletedAt: "desc" },
    });
}

/**
 * Permanently delete ALL backed-up suggested roles for the user. This is the ONLY
 * hard delete in the suggestions flow and is invoked from Settings.
 */
export async function purgeDeletedRoles(): Promise<{ purged: number }> {
    const user = await requireUser();
    const res = await db.deletedSuggestedRole.deleteMany({ where: { userId: user.id } });
    revalidateSearch();
    return { purged: res.count };
}
