import type {
    JobStatus,
    WorkType,
    JobDocumentKind,
    ContactMethod,
    JobLevel,
    InterviewFormat,
    RoundOutcome,
    OfferStatus,
    NegotiationKind,
    JobContactKind,
} from "@prisma/client";

export const STATUS_LABELS: Record<JobStatus, string> = {
    NOT_STARTED: "Not started",
    APPLIED: "Applied",
    UNDER_REVIEW: "Under review",
    ASSESSMENT: "Assessment",
    INTERVIEWING: "Interviewing",
    OFFERED: "Offered",
    OFFER_ACCEPTED: "Offer accepted",
    OFFER_DECLINED: "Offer declined",
    REJECTED: "Rejected",
    GHOSTED: "Ghosted",
    WITHDRAWN: "Withdrawn",
};

export const STATUS_ORDER: JobStatus[] = [
    "NOT_STARTED",
    "APPLIED",
    "UNDER_REVIEW",
    "ASSESSMENT",
    "INTERVIEWING",
    "OFFERED",
    "OFFER_ACCEPTED",
    "OFFER_DECLINED",
    "REJECTED",
    "GHOSTED",
    "WITHDRAWN",
];

/** Active pipeline statuses (count toward "in progress"). */
export const ACTIVE_STATUSES: JobStatus[] = [
    "NOT_STARTED",
    "APPLIED",
    "UNDER_REVIEW",
    "ASSESSMENT",
    "INTERVIEWING",
    "OFFERED",
];

export const CLOSED_STATUSES: JobStatus[] = [
    "OFFER_ACCEPTED",
    "OFFER_DECLINED",
    "REJECTED",
    "GHOSTED",
    "WITHDRAWN",
];

/** Untitled UI Badge color per status (semantic, light + dark safe). */
export const STATUS_BADGE_COLOR: Record<
    JobStatus,
    "gray" | "brand" | "error" | "warning" | "success" | "slate" | "sky" | "blue" | "indigo" | "purple" | "pink" | "orange"
> = {
    NOT_STARTED: "gray",
    APPLIED: "blue",
    UNDER_REVIEW: "sky",
    ASSESSMENT: "indigo",
    INTERVIEWING: "warning",
    OFFERED: "purple",
    OFFER_ACCEPTED: "success",
    OFFER_DECLINED: "orange",
    REJECTED: "error",
    GHOSTED: "slate",
    WITHDRAWN: "gray",
};

/** Hex colors per status for recharts bars. */
export const STATUS_HEX: Record<JobStatus, string> = {
    NOT_STARTED: "#a1a1aa",
    APPLIED: "#3b82f6",
    UNDER_REVIEW: "#0ea5e9",
    ASSESSMENT: "#6366f1",
    INTERVIEWING: "#f59e0b",
    OFFERED: "#8b5cf6",
    OFFER_ACCEPTED: "#22c55e",
    OFFER_DECLINED: "#f97316",
    REJECTED: "#ef4444",
    GHOSTED: "#71717a",
    WITHDRAWN: "#94a3b8",
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
    HYBRID: "Hybrid",
    REMOTE: "Remote",
    IN_OFFICE: "In-office",
    NA: "N/A",
};

/** Known job-source presets shown in the source picker with logos. */
export const HEARD_FROM_SOURCES = [
    { id: "LINKEDIN",      label: "LinkedIn",       domain: "linkedin.com" },
    { id: "HANDSHAKE",     label: "Handshake",      domain: "joinhandshake.com" },
    { id: "INDEED",        label: "Indeed",          domain: "indeed.com" },
    { id: "STARTUP_JOBS",  label: "Startup Jobs",   domain: "startup.jobs" },
    { id: "ZIPRECRUITER",  label: "ZipRecruiter",   domain: "ziprecruiter.com" },
    { id: "YCOMBINATOR",   label: "Y Combinator",   domain: "ycombinator.com" },
    { id: "WELLFOUND",     label: "Wellfound",      domain: "wellfound.com" },
    { id: "GLASSDOOR",     label: "Glassdoor",      domain: "glassdoor.com" },
    { id: "SIMPLIFY",      label: "Simplify",       domain: "simplify.jobs" },
    { id: "GOOGLE_JOBS",   label: "Google Jobs",    domain: "google.com" },
    { id: "FAMILY_FRIENDS",label: "Family / Friends", domain: null },
    { id: "OTHER",         label: "Other",           domain: null },
] as const;

/** Maps old enum keys AND labels to display strings. Falls back to the raw value for custom entries. */
export const HEARD_FROM_LABELS: Record<string, string> = Object.fromEntries(
    HEARD_FROM_SOURCES.map((s) => [s.id, s.label]),
);

export const DOCUMENT_KIND_LABELS: Record<JobDocumentKind, string> = {
    RESUME: "Resume",
    COVER_LETTER: "Cover letter",
    CERTIFICATION: "Certification",
    EDUCATION: "Education",
    CAREER_OTHER: "Career other",
};

export const JOB_LEVEL_LABELS: Record<JobLevel, string> = {
    INTERNSHIP: "Internship",
    ENTRY: "Entry level",
    JUNIOR: "Junior",
    MID: "Mid level",
    SENIOR: "Senior",
    LEAD: "Lead / Staff",
    UNKNOWN: "Unspecified",
};

/** Badge color per level (Untitled UI semantic-safe). */
export const JOB_LEVEL_BADGE_COLOR: Record<JobLevel, "gray" | "brand" | "success" | "blue" | "indigo" | "purple" | "orange"> = {
    INTERNSHIP: "blue",
    ENTRY: "success",
    JUNIOR: "brand",
    MID: "indigo",
    SENIOR: "purple",
    LEAD: "orange",
    UNKNOWN: "gray",
};

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
    LINKEDIN: "LinkedIn",
    EMAIL: "Email",
    PHONE: "Phone",
    DISCORD: "Discord",
};

export const INTERVIEW_FORMAT_LABELS: Record<InterviewFormat, string> = {
    PHONE: "Phone",
    VIDEO: "Video",
    ONSITE: "On-site",
    TAKE_HOME: "Take-home",
    PANEL: "Panel",
    OTHER: "Other",
};

export const ROUND_OUTCOME_LABELS: Record<RoundOutcome, string> = {
    PENDING: "Pending",
    PASSED: "Passed",
    FAILED: "Did not pass",
    CANCELLED: "Cancelled",
    NO_SHOW: "No-show",
    WITHDREW: "Withdrew",
};

export const ROUND_OUTCOME_BADGE_COLOR: Record<RoundOutcome, "gray" | "success" | "error" | "warning" | "slate"> = {
    PENDING: "warning",
    PASSED: "success",
    FAILED: "error",
    CANCELLED: "gray",
    NO_SHOW: "slate",
    WITHDREW: "gray",
};

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
    RECEIVED: "Received",
    NEGOTIATING: "Negotiating",
    ACCEPTED: "Accepted",
    DECLINED: "Declined",
    RESCINDED: "Rescinded",
    EXPIRED: "Expired",
};

export const OFFER_STATUS_BADGE_COLOR: Record<OfferStatus, "gray" | "brand" | "success" | "error" | "warning" | "orange"> = {
    RECEIVED: "brand",
    NEGOTIATING: "warning",
    ACCEPTED: "success",
    DECLINED: "error",
    RESCINDED: "error",
    EXPIRED: "gray",
};

export const NEGOTIATION_KIND_LABELS: Record<NegotiationKind, string> = {
    INITIAL: "Initial offer",
    COUNTER: "Counter",
    REVISED: "Revised offer",
    FINAL: "Final",
};

export const JOB_CONTACT_KIND_LABELS: Record<JobContactKind, string> = {
    RECRUITER: "Recruiter",
    HIRING_MANAGER: "Hiring manager",
    REFERRAL: "Referral",
    INTERVIEWER: "Interviewer",
    TEAM_MEMBER: "Team member",
    OTHER: "Other",
};

export const PRIORITY_LABELS: Record<number, string> = {
    0: "None",
    1: "Backup",
    2: "Interested",
    3: "Dream role",
};

/** Turn a label map into native-select options. */
export function toOptions<T extends string>(map: Record<T, string>) {
    return (Object.keys(map) as T[]).map((value) => ({ value, label: map[value] }));
}
