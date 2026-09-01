import { useMemo, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import {
    ActivityHeart,
    ArrowRight,
    Calendar,
    Check,
    Clock,
    Gift01,
    Grid01,
    Heart,
    Link01,
    Mail01,
    MessageChatCircle,
    Phone,
    Plus,
    Send01,
    Target01,
    TrendUp01,
    Users01,
    XClose,
} from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { RichSelect } from "@/components/base/select/rich-select";
import { SocialCanvas, type SocialCanvasConnection, type SocialCanvasRun } from "./social-canvas";

type HealthStatus = "healthy" | "due" | "overdue";
type GiftStage = "idea" | "purchased" | "wrapped" | "delivered";
type WorkspaceMode = "map" | "health" | "gifts" | "events";

interface TimelineItem {
    id: string;
    kind: string;
    type: string | null;
    date: string;
    notes: string | null;
    sentiment?: string | null;
}

interface SocialContact {
    id: string;
    displayName: string;
    avatarKey?: string | null;
    avatarUrl?: string | null;
    relationshipType: string | null;
    tier: string;
    howWeMet: string | null;
    birthday?: string | null;
    occupation?: string | null;
    companyOrSchool: string | null;
    hometown?: string | null;
    timezone?: string | null;
    pronouns?: string | null;
    status?: string | null;
    interests?: string | null;
    notes: string | null;
    innerCircle: boolean;
    cadenceDays: number;
    preferredContactMethod: string | null;
    lastContactAt?: string | null;
    daysSince: number | null;
    nextDueAt?: string;
    healthScore: number;
    healthStatus: HealthStatus | string;
    cadenceProgress?: number;
    emails?: Array<{ id: string; email: string; isPrimary: boolean }>;
    phones?: Array<{ id: string; phone: string; isPrimary: boolean }>;
    handles: Array<{ id: string; platform: string; handle: string }>;
    tags?: Array<{ id: string; name: string; color?: string | null }>;
    reminders?: Array<{ id: string; reminderType: string | null; scheduledFor: string }>;
    timeline?: TimelineItem[];
    memories?: Array<{ id: string; title: string | null; description: string; memoryDate: string | null; location: string | null }>;
    milestones?: Array<{ id: string; kind: string; date: string; days: number }>;
}

interface GiftItem {
    id: string;
    contactId: string;
    contactName: string;
    description: string;
    occasion: string | null;
    givenDate: string | null;
    stage: GiftStage | string;
}

interface SocialEventItem {
    id: string;
    name: string;
    eventDate: string | null;
    location: string | null;
    attendees: string[];
    notes: string | null;
    coverImageUrl?: string | null;
}

export interface SocialIntelligenceData {
    generatedAt?: string;
    metrics?: {
        healthScore: number;
        healthy: number;
        due: number;
        overdue: number;
        currentMonthInteractions?: number;
        previousMonthInteractions?: number;
        monthlyTarget?: number;
        socialBudgetPercent?: number;
        momentum?: number;
        plannedEvents?: number;
    };
    contacts?: SocialContact[];
    connections?: SocialCanvasConnection[];
    activity?: Array<{ date: string; count: number; level: number }>;
    gifts?: GiftItem[];
    upcomingMilestones?: Array<{ id: string; contactId: string; contactName: string; kind: string; date: string; days: number }>;
    events?: SocialEventItem[];
    drafts?: Array<{ id: string; contactId: string | null; contactName: string | null; channel: string | null; body: string; dueAt: string | null }>;
    integrations?: Array<{ id: string; label: string; status: string; detail: string }>;
}

const SURFACE = "rounded-xl border border-secondary bg-primary";
const INPUT = "w-full rounded-lg border border-secondary bg-primary px-3 py-2.5 text-sm text-primary outline-none placeholder:text-quaternary focus:border-brand focus:ring-2 focus:ring-brand/15";
const LABEL = "flex flex-col gap-1.5 text-xs font-medium text-secondary";
const PRIMARY = "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-solid px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-solid_hover disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY = "inline-flex items-center justify-center gap-2 rounded-lg border border-secondary bg-primary px-3.5 py-2.5 text-sm font-semibold text-secondary transition hover:bg-primary_hover hover:text-primary disabled:opacity-50";

const GIFT_STAGES: Array<{ id: GiftStage; label: string; detail: string }> = [
    { id: "idea", label: "Ideas", detail: "Captured in conversation" },
    { id: "purchased", label: "Purchased", detail: "Ready to prepare" },
    { id: "wrapped", label: "Wrapped", detail: "Ready to give" },
    { id: "delivered", label: "Delivered", detail: "Gift history" },
];

function formatDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions) {
    if (!value) return "No date";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, options ?? { month: "short", day: "numeric", year: "numeric" });
}

function initials(name: string) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function contactChannel(contact: SocialContact) {
    const email = contact.emails?.find((entry) => entry.isPrimary)?.email ?? contact.emails?.[0]?.email;
    const phone = contact.phones?.find((entry) => entry.isPrimary)?.phone ?? contact.phones?.[0]?.phone;
    return { email, phone };
}

function statusColor(status: string) {
    if (status === "healthy") return "#34d399";
    if (status === "due") return "#fbbf24";
    return "#fb7185";
}

export function SocialIntelligenceWorkspace({
    data,
    run,
    pending,
    onAddContact,
    mode: controlledMode,
    hideModeNavigation = false,
}: {
    data: SocialIntelligenceData;
    run: SocialCanvasRun;
    pending: string | null;
    onAddContact: () => void;
    mode?: WorkspaceMode;
    hideModeNavigation?: boolean;
}) {
    const [localMode, setLocalMode] = useState<WorkspaceMode>("map");
    const mode = controlledMode ?? localMode;
    const contacts = data.contacts ?? [];
    const connections = data.connections ?? [];
    const metrics = data.metrics ?? { healthScore: 100, healthy: 0, due: 0, overdue: 0 };

    const modes: Array<{ id: WorkspaceMode; label: string; icon: typeof Grid01 }> = [
        { id: "map", label: "Topology", icon: Grid01 },
        { id: "health", label: "Social health", icon: ActivityHeart },
        { id: "gifts", label: "Gifts & memories", icon: Gift01 },
        { id: "events", label: "Event command", icon: Calendar },
    ];

    return (
        <div className="min-h-0 text-primary">
            {mode === "map" && (
                <div className="-mx-3 -mb-3 h-[calc(100dvh-15rem)] min-h-[42rem] max-h-[calc(100dvh-8rem)] p-3">
                    <SocialCanvas
                        data={{ contacts, connections, metrics }}
                        run={run}
                        pending={pending}
                        onAddContact={onAddContact}
                    />
                </div>
            )}
            {mode === "health" && <HealthPanel data={data} run={run} pending={pending} />}
            {mode === "gifts" && <GiftPanel contacts={contacts} gifts={data.gifts ?? []} run={run} pending={pending} />}
            {mode === "events" && <EventPanel contacts={contacts} events={data.events ?? []} drafts={data.drafts ?? []} run={run} pending={pending} />}
        </div>
    );
}

function MetricCard({ label, value, detail, icon: Icon, accent }: { label: string; value: ReactNode; detail: string; icon: typeof Heart; accent: string }) {
    return (
        <div className={`${SURFACE} p-4`}>
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-secondary">{label}</span>
                <span className="grid size-8 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}><Icon className="size-4" /></span>
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight">{value}</p>
            <p className="mt-1 text-xs text-tertiary">{detail}</p>
        </div>
    );
}

function HealthPanel({ data, run, pending }: { data: SocialIntelligenceData; run: SocialCanvasRun; pending: string | null }) {
    const contacts = data.contacts ?? [];
    const metrics = data.metrics ?? { healthScore: 100, healthy: 0, due: 0, overdue: 0 };
    const [logContactId, setLogContactId] = useState("");
    const focus = useMemo(() => [...contacts].filter((contact) => contact.healthStatus !== "healthy").sort((a, b) => a.healthScore - b.healthScore), [contacts]);
    const activity = data.activity ?? [];
    const milestones = data.upcomingMilestones ?? [];

    const submitInteraction = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await run("social:logInteraction", {
            contactId: String(values.get("contactId") ?? ""),
            interactionType: String(values.get("interactionType") ?? "catch-up"),
            date: String(values.get("date") ?? ""),
            notes: String(values.get("notes") ?? ""),
        });
        if (ok) { form.reset(); setLogContactId(""); }
    };

    return (
        <div className="space-y-5 p-5 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Relationship health" value={`${metrics.healthScore}%`} detail="Weighted across active people" icon={Heart} accent="#a78bfa" />
                <MetricCard label="Needs attention" value={(metrics.due ?? 0) + (metrics.overdue ?? 0)} detail={`${metrics.overdue ?? 0} beyond cadence`} icon={Clock} accent="#fb7185" />
                <MetricCard label="Monthly momentum" value={`${(metrics.momentum ?? 0) >= 0 ? "+" : ""}${metrics.momentum ?? 0}%`} detail={`${metrics.currentMonthInteractions ?? 0} meaningful touches`} icon={TrendUp01} accent="#34d399" />
                <MetricCard label="Plans in motion" value={metrics.plannedEvents ?? 0} detail="Upcoming shared experiences" icon={Calendar} accent="#38bdf8" />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
                <section className={`${SURFACE} p-5`}>
                    <div className="flex items-start justify-between gap-4">
                        <div><h3 className="text-sm font-semibold text-primary">Social investment</h3><p className="mt-1 text-xs text-tertiary">Actual meaningful touches against your cadence-derived monthly target.</p></div>
                        <span className="text-2xl font-semibold">{metrics.socialBudgetPercent ?? 0}%</span>
                    </div>
                    <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-[linear-gradient(90deg,#7c3aed,#a78bfa,#38bdf8)] transition-[width]" style={{ width: `${Math.min(100, metrics.socialBudgetPercent ?? 0)}%` }} />
                    </div>
                    <div className="mt-2 flex justify-between text-[11px] text-tertiary"><span>{metrics.currentMonthInteractions ?? 0} logged</span><span>{metrics.monthlyTarget ?? 0} target</span></div>

                    <div className="mt-7 flex items-end justify-between gap-3">
                        <div><h4 className="text-sm font-semibold text-primary">84-day activity</h4><p className="mt-1 text-xs text-tertiary">A quiet calendar is a signal, not a judgment.</p></div>
                        <div className="flex items-center gap-1 text-[10px] text-quaternary"><span>Less</span>{[0,1,2,3,4].map((level) => <span key={level} className="size-2.5 rounded-[3px]" style={{ background: level === 0 ? "var(--surface-2)" : `color-mix(in srgb, var(--brand) ${20 + level * 18}%, transparent)` }} />)}<span>More</span></div>
                    </div>
                    <div className="mt-3 grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto pb-1">
                        {activity.map((day) => <span key={day.date} title={`${formatDate(day.date)} · ${day.count} interactions`} className="size-3 rounded-[3px]" style={{ background: day.level === 0 ? "rgba(255,255,255,.055)" : `rgba(139,92,246,${0.18 + day.level * 0.18})` }} />)}
                    </div>
                </section>

                <section className={`${SURFACE} p-5`}>
                    <div className="flex items-center gap-2"><Target01 className="size-4 text-amber-300" /><h3 className="text-sm font-semibold">Reason to reach out</h3></div>
                    <div className="mt-4 space-y-2.5">
                        {milestones.slice(0, 5).map((milestone) => (
                            <button key={`${milestone.contactId}:${milestone.id}`} type="button" onClick={() => setLogContactId(milestone.contactId)} className="flex w-full items-center gap-3 rounded-xl border border-secondary bg-primary p-3 text-left transition hover:bg-primary_hover">
                                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-400/10 text-xs font-semibold text-amber-200">{milestone.days}d</span>
                                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-primary">{milestone.contactName}</span><span className="block truncate text-xs text-tertiary">{milestone.kind} · {formatDate(milestone.date, { month: "short", day: "numeric" })}</span></span>
                                <ArrowRight className="size-4 text-quaternary" />
                            </button>
                        ))}
                        {milestones.length === 0 && <p className="rounded-xl border border-dashed border-secondary px-4 py-8 text-center text-sm text-tertiary">No milestones in the next 45 days.</p>}
                    </div>
                </section>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                <section className={`${SURFACE} overflow-hidden`}>
                    <div className="flex items-center justify-between border-b border-secondary px-5 py-4"><div><h3 className="text-sm font-semibold text-primary">This week’s focus</h3><p className="mt-0.5 text-xs text-tertiary">Ordered by relationship health and expected cadence.</p></div><span className="rounded-full bg-error-primary px-2.5 py-1 text-xs font-medium text-error-primary">{focus.length} open</span></div>
                    <div className="divide-y divide-white/[0.06]">
                        {focus.slice(0, 7).map((contact) => {
                            const channel = contactChannel(contact);
                            return (
                                <div key={contact.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                                    <Avatar contact={contact} />
                                    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium text-primary">{contact.displayName}</p><span className="size-2 rounded-full" style={{ background: statusColor(contact.healthStatus) }} /></div><p className="mt-0.5 text-xs text-tertiary">{contact.tier} · {contact.daysSince == null ? "No interaction yet" : `${contact.daysSince} days since last touch`} · every {contact.cadenceDays}d</p></div>
                                    <div className="flex gap-1.5">
                                        {channel.phone && <a href={`tel:${channel.phone}`} className={SECONDARY} title="Call"><Phone className="size-3.5" /></a>}
                                        {channel.email && <a href={`mailto:${channel.email}`} className={SECONDARY} title="Email"><Mail01 className="size-3.5" /></a>}
                                        <button type="button" className={PRIMARY} onClick={() => setLogContactId(contact.id)}><Check className="size-3.5" />Log touch</button>
                                    </div>
                                </div>
                            );
                        })}
                        {focus.length === 0 && <p className="px-5 py-10 text-center text-sm text-tertiary">Everyone is inside their preferred cadence.</p>}
                    </div>
                </section>

                <section className={`${SURFACE} p-5`}>
                    <div className="flex items-center gap-2"><Link01 className="size-4 text-sky-300" /><h3 className="text-sm font-semibold">Automation bridge</h3></div>
                    <p className="mt-1 text-xs text-tertiary">API-first hooks turn communication into context without forcing manual entry.</p>
                    <div className="mt-4 space-y-2.5">
                        {(data.integrations ?? []).map((integration) => (
                            <div key={integration.id} className="rounded-xl border border-secondary bg-primary p-3.5">
                                <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-primary">{integration.label}</span><span className={cx("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", integration.status === "available" ? "bg-success-primary text-success-primary" : "bg-secondary text-tertiary")}>{integration.status}</span></div>
                                <p className="mt-1 text-xs leading-relaxed text-tertiary">{integration.detail}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            {logContactId && (
                <InlineDialog title="Log a meaningful touch" onClose={() => setLogContactId("")}>
                    <form onSubmit={submitInteraction} className="space-y-3">
                        <input type="hidden" name="contactId" value={logContactId} />
                        <div className="grid gap-3 sm:grid-cols-2"><label className={LABEL}>Channel<RichSelect name="interactionType" defaultValue="catch-up" options={[{ value: "catch-up", label: "Catch-up" }, { value: "call", label: "Call" }, { value: "text", label: "Text" }, { value: "email", label: "Email" }, { value: "dinner", label: "Dinner" }, { value: "gift", label: "Gift" }, { value: "event", label: "Shared event" }]} /></label><label className={LABEL}>Date<input name="date" type="datetime-local" className={INPUT} /></label></div>
                        <label className={LABEL}>What mattered?<textarea name="notes" className={`${INPUT} min-h-24 resize-y`} placeholder="Topics, changes, follow-ups, or something worth remembering…" /></label>
                        <button className={PRIMARY} disabled={pending !== null}><Check className="size-4" />Save to timeline</button>
                    </form>
                </InlineDialog>
            )}
        </div>
    );
}

function GiftPanel({ contacts, gifts, run, pending }: { contacts: SocialContact[]; gifts: GiftItem[]; run: SocialCanvasRun; pending: string | null }) {
    const [showAdd, setShowAdd] = useState(false);
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await run("social:createGift", { contactId: String(values.get("contactId") ?? ""), description: String(values.get("description") ?? ""), occasion: String(values.get("occasion") ?? ""), stage: "idea" });
        if (ok) { form.reset(); setShowAdd(false); }
    };
    const drop = (event: DragEvent, stage: GiftStage) => {
        event.preventDefault();
        const id = event.dataTransfer.getData("text/social-gift");
        if (id) void run("social:updateGiftStage", { id, stage });
    };

    return (
        <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-base font-semibold text-primary">Gift pipeline</h3><p className="mt-1 text-sm text-tertiary">Keep the small signals, avoid repeats, and move ideas from mention to meaningful delivery.</p></div><button type="button" className={PRIMARY} onClick={() => setShowAdd(true)}><Plus className="size-4" />Capture an idea</button></div>
            <div className="mt-5 grid gap-3 xl:grid-cols-4">
                {GIFT_STAGES.map((stage) => {
                    const rows = gifts.filter((gift) => gift.stage === stage.id);
                    return (
                        <section key={stage.id} className={`${SURFACE} min-h-72 p-3`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, stage.id)}>
                            <div className="flex items-start justify-between gap-3 px-1 py-1"><div><h4 className="text-sm font-semibold text-primary">{stage.label}</h4><p className="mt-0.5 text-[11px] text-tertiary">{stage.detail}</p></div><span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary">{rows.length}</span></div>
                            <div className="mt-3 space-y-2">
                                {rows.map((gift) => (
                                    <article key={gift.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/social-gift", gift.id); }} className="cursor-grab rounded-xl border border-secondary bg-primary p-3 shadow-sm active:cursor-grabbing">
                                        <div className="flex gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-primary text-brand-secondary"><Gift01 className="size-4" /></span><div className="min-w-0"><p className="text-sm font-medium leading-snug text-primary">{gift.description}</p><p className="mt-1 text-xs text-tertiary">{gift.contactName}{gift.occasion ? ` · ${gift.occasion}` : ""}</p>{gift.givenDate && <p className="mt-1 text-[10px] text-quaternary">{formatDate(gift.givenDate)}</p>}</div></div>
                                    </article>
                                ))}
                                {rows.length === 0 && <div className="rounded-xl border border-dashed border-secondary px-3 py-8 text-center text-xs text-quaternary">Drop gifts here</div>}
                            </div>
                        </section>
                    );
                })}
            </div>
            {showAdd && (
                <InlineDialog title="Capture gift idea" onClose={() => setShowAdd(false)}>
                    <form onSubmit={submit} className="space-y-3"><label className={LABEL}>For<RichSelect name="contactId" placeholder="Choose a person…" options={contacts.map((contact) => ({ value: contact.id, label: contact.displayName }))} /></label><label className={LABEL}>Gift idea<input className={INPUT} name="description" required placeholder="The espresso grinder they mentioned…" /></label><label className={LABEL}>Occasion or context<RichSelect name="occasion" placeholder="Choose an occasion" options={[{ value: "Birthday", label: "Birthday" }, { value: "Holiday", label: "Holiday" }, { value: "Anniversary", label: "Anniversary" }, { value: "Housewarming", label: "Housewarming" }, { value: "Just because", label: "Just because" }]} /></label><button className={PRIMARY} disabled={pending !== null}><Gift01 className="size-4" />Save idea</button></form>
                </InlineDialog>
            )}
        </div>
    );
}

function EventPanel({ contacts, events, drafts, run, pending }: { contacts: SocialContact[]; events: SocialEventItem[]; drafts: SocialIntelligenceData["drafts"]; run: SocialCanvasRun; pending: string | null }) {
    const [showAdd, setShowAdd] = useState(false);
    const now = Date.now();
    const buckets = [
        { id: "planning", label: "Planning", detail: "No date locked", rows: events.filter((event) => !event.eventDate) },
        { id: "upcoming", label: "Upcoming", detail: "On the calendar", rows: events.filter((event) => event.eventDate && new Date(event.eventDate).getTime() >= now) },
        { id: "memories", label: "Shared memories", detail: "Past experiences", rows: events.filter((event) => event.eventDate && new Date(event.eventDate).getTime() < now).reverse() },
    ];
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await run("social:createEvent", { name: String(values.get("name") ?? ""), eventDate: String(values.get("eventDate") ?? ""), location: String(values.get("location") ?? ""), attendees: String(values.get("attendees") ?? ""), notes: String(values.get("notes") ?? "") });
        if (ok) { form.reset(); setShowAdd(false); }
    };

    return (
        <div className="space-y-5 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-base font-semibold text-primary">Event command center</h3><p className="mt-1 text-sm text-tertiary">Move gatherings from a loose idea to a shared memory—with guests, logistics, and outreach together.</p></div><button type="button" className={PRIMARY} onClick={() => setShowAdd(true)}><Plus className="size-4" />Plan an event</button></div>
            <div className="grid gap-4 xl:grid-cols-3">
                {buckets.map((bucket) => (
                    <section key={bucket.id} className={`${SURFACE} min-h-72 p-3`}>
                        <div className="flex items-start justify-between gap-3 px-1 py-1"><div><h4 className="text-sm font-semibold text-primary">{bucket.label}</h4><p className="mt-0.5 text-[11px] text-tertiary">{bucket.detail}</p></div><span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary">{bucket.rows.length}</span></div>
                        <div className="mt-3 space-y-2.5">
                            {bucket.rows.map((event) => (
                                <article key={event.id} className="overflow-hidden rounded-xl border border-secondary bg-primary">
                                    {event.coverImageUrl && <img src={event.coverImageUrl} alt="" className="h-24 w-full object-cover opacity-80" />}
                                    <div className="p-3.5">
                                        <p className="text-sm font-semibold">{event.name}</p>
                                        <div className="mt-2 space-y-1 text-xs text-tertiary">
                                            {event.eventDate && <p className="flex items-center gap-1.5"><Calendar className="size-3.5" />{formatDate(event.eventDate)}</p>}
                                            {event.location && <p className="flex items-center gap-1.5"><Target01 className="size-3.5" />{event.location}</p>}
                                        </div>
                                        {event.attendees.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{event.attendees.slice(0, 6).map((attendee) => <span key={attendee} className="rounded-full bg-secondary px-2 py-1 text-[10px] text-secondary">{attendee}</span>)}</div>}
                                        {event.notes && <div className="mt-3 space-y-1 border-t border-secondary pt-3">{event.notes.split(/\r?\n/).filter(Boolean).slice(0, 4).map((note, index) => <p key={`${note}:${index}`} className="flex gap-2 text-[11px] text-tertiary"><span className="mt-0.5 grid size-3.5 shrink-0 place-items-center rounded border border-secondary"><Check className="size-2.5" /></span>{note.replace(/^[-*]\s*/, "")}</p>)}</div>}
                                        {bucket.id !== "memories" && (
                                            <button type="button" className={`${SECONDARY} mt-3 w-full`} disabled={pending !== null || event.attendees.length === 0} onClick={() => void run("social:draftEventInvites", { eventId: event.id })}>
                                                <Send01 className="size-3.5" />Draft invitations
                                            </button>
                                        )}
                                    </div>
                                </article>
                            ))}
                            {bucket.rows.length === 0 && <div className="rounded-xl border border-dashed border-secondary px-3 py-8 text-center text-xs text-quaternary">Nothing here yet</div>}
                        </div>
                    </section>
                ))}
            </div>
            {(drafts?.length ?? 0) > 0 && <section className={`${SURFACE} p-4`}><div className="flex items-center gap-2"><Send01 className="size-4 text-brand-secondary" /><h4 className="text-sm font-semibold text-primary">Outreach queued</h4></div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{drafts?.slice(0, 6).map((draft) => <div key={draft.id} className="rounded-xl border border-secondary bg-primary p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-primary">{draft.contactName ?? "General outreach"}</span><span className="text-[10px] uppercase text-quaternary">{draft.channel ?? "message"}</span></div><p className="mt-1 line-clamp-2 text-xs leading-relaxed text-tertiary">{draft.body}</p></div>)}</div></section>}
            {showAdd && (
                <InlineDialog title="Plan a shared experience" onClose={() => setShowAdd(false)}>
                    <form onSubmit={submit} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className={LABEL}>Event name<input className={INPUT} name="name" required placeholder="Sunday supper" /></label><label className={LABEL}>Date and time<input className={INPUT} name="eventDate" type="datetime-local" /></label></div><label className={LABEL}>Location<input className={INPUT} name="location" placeholder="Home, restaurant, city…" /></label><label className={LABEL}>Attendees<input className={INPUT} name="attendees" list="social-event-people" placeholder="Comma-separated names" /><datalist id="social-event-people">{contacts.map((contact) => <option key={contact.id} value={contact.displayName} />)}</datalist></label><label className={LABEL}>Logistics checklist<textarea className={`${INPUT} min-h-24 resize-y`} name="notes" placeholder={"Confirm guest list\nBook table\nCheck dietary restrictions\nSend final details"} /></label><button className={PRIMARY} disabled={pending !== null}><Calendar className="size-4" />Create plan</button></form>
                </InlineDialog>
            )}
        </div>
    );
}

function Avatar({ contact }: { contact: SocialContact }) {
    const [failed, setFailed] = useState(false);
    return <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-secondary bg-secondary text-xs font-semibold text-secondary">{initials(contact.displayName)}{contact.avatarUrl && !failed && <img src={contact.avatarUrl} alt="" className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />}</span>;
}

function InlineDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    return (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-xl rounded-xl border border-secondary bg-primary p-5 shadow-xl">
                <div className="mb-4 flex items-center justify-between gap-3"><h3 className="text-base font-semibold text-primary">{title}</h3><button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-quaternary transition hover:bg-primary_hover hover:text-primary"><XClose className="size-4" /></button></div>
                {children}
            </div>
        </div>
    );
}

export default SocialIntelligenceWorkspace;
