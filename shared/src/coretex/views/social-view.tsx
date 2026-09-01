import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Calendar, Edit01, Grid01, Link01, Maximize01, Plus, Route, Share07, Stars01, Tag01, Trash01, Users01, XClose } from "@untitledui/icons";
import { RichSelect } from "@/components/base/select/rich-select";
import {
    EmptyMessage,
    PersonalCard,
    PersonalModuleShell,
    PersonalTable,
    QueryBoundary,
    StatGrid,
    formatDate,
    titleCase,
    type PersonalTab,
} from "./personal/personal-ui";
import { useLifeOSQuery, type LifeOSClient } from "./personal/use-lifeos-query";
import { SocialIntelligenceWorkspace, type SocialIntelligenceData } from "./social-intelligence";
import { CanvasActionDock } from "./canvas-action-dock";
import {
    SocialCanvasDockContext,
    type SocialCanvasControls,
    type SocialCanvasPresentationState,
} from "./social-canvas";

const TABS: PersonalTab[] = [
    { id: "overview", label: "Dashboard" },
    { id: "canvas", label: "Canvas" },
    { id: "health", label: "Social health" },
    { id: "gifts", label: "Gifts & memories" },
    { id: "contacts", label: "Contacts" },
    { id: "calendar", label: "Calendar" },
    { id: "drafts", label: "Drafts" },
    { id: "events", label: "Events" },
];

const COMMANDS: Record<string, string> = {
    overview: "social:getOverview",
    canvas: "social:getCanvas",
    health: "social:getCanvas",
    gifts: "social:getCanvas",
    contacts: "social:getContacts",
    calendar: "social:getCalendar",
    drafts: "social:getDrafts",
    events: "social:getEvents",
};

const INPUT_CLASS = "w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const LABEL_CLASS = "flex flex-col gap-1.5 text-xs font-medium text-secondary";
const PRIMARY_BUTTON = "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-solid_hover disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON = "inline-flex items-center justify-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-semibold text-secondary transition hover:bg-primary_hover disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_BUTTON = "inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-error-primary transition hover:bg-error-primary disabled:cursor-not-allowed disabled:opacity-50";

interface TagRow {
    id: string;
    name: string;
    color?: string | null;
    contactCount?: number;
}

interface ContactRow {
    id: string;
    displayName: string;
    avatarKey?: string | null;
    avatarUrl?: string | null;
    relationshipType: string | null;
    companyOrSchool: string | null;
    lastContactAt: string | null;
    innerCircle: boolean;
    active: boolean;
    tags?: TagRow[];
    emails?: Array<{ id: string; email: string; isPrimary: boolean }>;
    phones?: Array<{ id: string; phone: string; isPrimary: boolean }>;
    handles?: Array<{ id: string; platform: string; handle: string }>;
}

interface ContactRef {
    id: string;
    displayName: string;
}

interface DraftRow {
    id: string;
    contactId: string | null;
    contactName: string | null;
    channel: string | null;
    body: string;
    dueAt: string | null;
    sentAt?: string | null;
    archived?: boolean;
}

interface EventRow {
    id: string;
    name: string;
    coverImageKey?: string | null;
    coverImageUrl?: string | null;
    eventDate: string | null;
    location: string | null;
    notes: string | null;
}

function PersonCell({ contact }: { contact: Pick<ContactRow, "displayName" | "avatarUrl"> }) {
    const [imageFailed, setImageFailed] = useState(false);
    return (
        <span className="flex min-w-0 items-center gap-2.5">
            <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-secondary text-xs font-semibold text-brand-secondary">
                {(contact.displayName.trim()[0] || "?").toUpperCase()}
                {contact.avatarUrl && !imageFailed && <img src={contact.avatarUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" onError={() => setImageFailed(true)} />}
            </span>
            <span className="truncate font-medium text-primary">{contact.displayName}</span>
        </span>
    );
}

function EventCell({ event }: { event: Pick<EventRow, "name" | "coverImageUrl"> }) {
    const [imageFailed, setImageFailed] = useState(false);
    return (
        <span className="flex min-w-0 items-center gap-2.5">
            <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-quaternary"><Calendar className="size-4" />{event.coverImageUrl && !imageFailed && <img src={event.coverImageUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" onError={() => setImageFailed(true)} />}</span>
            <span className="truncate font-medium text-primary">{event.name}</span>
        </span>
    );
}

interface BatteryRow {
    id: string;
    date: string;
    energyLevel: number;
    notes: string | null;
}

interface SocialData {
    stats?: { contacts: number; innerCircle: number; events: number; remindersDue: number };
    metrics?: SocialIntelligenceData["metrics"];
    connections?: SocialIntelligenceData["connections"];
    activity?: SocialIntelligenceData["activity"];
    gifts?: SocialIntelligenceData["gifts"];
    upcomingMilestones?: SocialIntelligenceData["upcomingMilestones"];
    integrations?: SocialIntelligenceData["integrations"];
    innerCircle?: ContactRow[];
    reachOut?: ContactRow[];
    recentInteractions?: Array<{ id: string; contactName: string; interactionType: string | null; date: string; notes: string | null }>;
    upcoming?: Array<{ id: string; name: string; kind: string; date: string; days: number }>;
    /** Contact rows from directory tabs, or full canvas contact cards from social:getCanvas. */
    contacts?: Array<ContactRow | NonNullable<SocialIntelligenceData["contacts"]>[number]>;
    tags?: TagRow[];
    annualDates?: Array<{ id: string; contactName: string; kind: string; date: string }>;
    drafts?: DraftRow[];
    events?: EventRow[];
    battery?: BatteryRow[];
}

export interface SocialViewProps {
    client: LifeOSClient;
}

let mutationSequence = 0;

function sendMutation(client: LifeOSClient, type: string, payload: Record<string, unknown>): Promise<unknown> {
    const requestId = `social_mutation_${Date.now()}_${++mutationSequence}`;
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            window.clearTimeout(timeout);
            client.offMessage(onMessage);
        };
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };
        const onMessage = (message: any) => {
            if (!message || message.type !== type || message.requestId !== requestId) return;
            if (message.error) finish(() => reject(new Error(String(message.error))));
            else finish(() => resolve(message.result));
        };
        const timeout = window.setTimeout(() => finish(() => reject(new Error("The Social action timed out. Try again."))), 15_000);
        client.onMessage(onMessage);
        if (!client.send({ type, requestId, payload })) {
            finish(() => reject(new Error("The Coretex service is offline.")));
        }
    });
}

function useSocialActions(client: LifeOSClient, onChanged: () => void) {
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pendingRef = useRef<string | null>(null);

    const run = useCallback(async (type: string, payload: Record<string, unknown>) => {
        if (pendingRef.current) return false;
        pendingRef.current = type;
        setPending(type);
        setError(null);
        try {
            await sendMutation(client, type, payload);
            onChanged();
            return true;
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
            return false;
        } finally {
            pendingRef.current = null;
            setPending(null);
        }
    }, [client, onChanged]);

    const request = useCallback(async (type: string, payload: Record<string, unknown>) => {
        if (pendingRef.current) return null;
        pendingRef.current = type;
        setPending(type);
        setError(null);
        try {
            return await sendMutation(client, type, payload);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
            return null;
        } finally {
            pendingRef.current = null;
            setPending(null);
        }
    }, [client]);

    return { run, request, pending, error, dismissError: () => setError(null) };
}

type SocialActions = ReturnType<typeof useSocialActions>;

export function SocialView({ client }: SocialViewProps) {
    const [activeTab, setActiveTab] = useState("overview");
    const [openContactComposer, setOpenContactComposer] = useState(false);
    const [contactComposerKey, setContactComposerKey] = useState(0);
    const canvasControls = useRef<SocialCanvasControls>(null);
    const [canvasPresentation, setCanvasPresentation] = useState<SocialCanvasPresentationState>({
        inspectorOpen: false,
        connectActive: false,
        depthVisible: true,
        wiresVisible: true,
    });
    const query = useLifeOSQuery<SocialData>(client, COMMANDS[activeTab] ?? COMMANDS.overview);
    const actions = useSocialActions(client, query.refresh);
    const dockMode = activeTab === "contacts" || activeTab === "canvas";
    const socialContactCount = query.data?.contacts?.length ?? 0;
    const openAddPerson = () => {
        setOpenContactComposer(true);
        setContactComposerKey((key) => key + 1);
        setActiveTab("contacts");
    };
    const chooseDockView = (view: "grid" | "graph") => {
        setOpenContactComposer(false);
        setActiveTab(view === "graph" ? "canvas" : "contacts");
    };

    return (
        <div className={dockMode ? "h-full min-h-0 overflow-hidden [&_[data-personal-module]]:!h-full [&_[data-personal-module]]:!min-h-0 [&_[data-personal-module]>div:last-child]:!min-h-0 [&_[data-personal-module]>div:last-child]:!overflow-hidden" : "min-h-0 min-w-0"}>
        <SocialCanvasDockContext.Provider value={{ controlsRef: canvasControls, onPresentationStateChange: setCanvasPresentation }}>
            <PersonalModuleShell
                title="Social"
                description="Keep relationships, reminders, events, and outreach in one private local workspace."
                icon={Users01}
                tabs={TABS}
                activeTab={activeTab}
                onTabChange={(tab) => { setOpenContactComposer(false); setActiveTab(tab); }}
                hero={dockMode ? undefined : {
                    gradient: "linear-gradient(120deg, #7c3aed 0%, #c026d3 50%, #ec4899 100%)",
                    eyebrow: "Relationships",
                    actions: [
                        ...(!dockMode ? [
                            { label: "Add contact", icon: Plus, variant: "primary" as const, onClick: openAddPerson },
                            { label: "Open canvas", icon: Share07, onClick: () => setActiveTab("canvas") },
                        ] : []),
                        { label: "New event", icon: Calendar, onClick: () => setActiveTab("events") },
                    ],
                }}
            >
                <QueryBoundary loading={query.loading && !query.data} error={query.error} onRetry={query.refresh}>
                    <div className={dockMode ? "relative flex h-full min-h-0 flex-col pb-28" : undefined}>
                        <div className={dockMode ? `min-h-0 flex-1 ${activeTab === "canvas" ? "overflow-hidden" : "overflow-y-auto"}` : undefined}>
                            {actions.error && <ActionError message={actions.error} onDismiss={actions.dismissError} />}
                            {query.data && (
                                <SocialSection
                                    tab={activeTab}
                                    data={query.data}
                                    actions={actions}
                                    onOpenCanvas={() => setActiveTab("canvas")}
                                    openContactComposer={openContactComposer}
                                    contactComposerKey={contactComposerKey}
                                    onContactComposerOpenChange={setOpenContactComposer}
                                    onAddContact={openAddPerson}
                                />
                            )}
                        </div>
                        {dockMode && query.data && (
                            <CanvasActionDock
                                label="Social directory and graph actions"
                                viewModes={[
                                    { id: "grid", label: "Grid", icon: Grid01, description: "Browse and manage the contact directory" },
                                    { id: "graph", label: "Graph", icon: Share07, description: "Map people and relationship connections" },
                                ] as const}
                                activeView={activeTab === "canvas" ? "graph" : "grid"}
                                onViewChange={chooseDockView}
                                inspectorOpen={activeTab === "canvas" && canvasPresentation.inspectorOpen}
                                actions={activeTab === "canvas" ? [
                                    { id: "wire", label: canvasPresentation.connectActive ? "Stop wiring" : "Wire friends", icon: Link01, description: "Choose two people to create a relationship link", active: canvasPresentation.connectActive, disabled: socialContactCount < 2, onClick: () => canvasControls.current?.toggleConnectMode() },
                                    { id: "arrange", label: "Arrange people", icon: Grid01, description: "Arrange contact cards without changing relationship data", disabled: socialContactCount < 1, onClick: () => canvasControls.current?.autoArrange() },
                                    { id: "wires", label: canvasPresentation.wiresVisible ? "Hide wires" : "Show wires", icon: Share07, description: "Toggle relationship lines", active: canvasPresentation.wiresVisible, onClick: () => canvasControls.current?.toggleWires() },
                                    { id: "depth", label: canvasPresentation.depthVisible ? "Hide depth" : "Show depth", icon: Route, description: "Toggle degree-of-separation highlighting", active: canvasPresentation.depthVisible, onClick: () => canvasControls.current?.toggleDepth() },
                                    { id: "fit", label: "Fit graph", icon: Maximize01, description: "Frame every person card", disabled: socialContactCount < 1, onClick: () => canvasControls.current?.fit() },
                                ] : []}
                                primaryAction={{
                                    id: "add-person",
                                    label: activeTab === "contacts" && openContactComposer ? "Close form" : "Add person",
                                    icon: activeTab === "contacts" && openContactComposer ? XClose : Plus,
                                    description: activeTab === "contacts" && openContactComposer ? "Close the contact composer" : "Open the existing contact composer",
                                    tone: activeTab === "contacts" && openContactComposer ? "default" : "brand",
                                    onClick: activeTab === "contacts" && openContactComposer ? () => setOpenContactComposer(false) : openAddPerson,
                                }}
                            />
                        )}
                    </div>
                </QueryBoundary>
            </PersonalModuleShell>
        </SocialCanvasDockContext.Provider>
        </div>
    );
}

function ActionError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
    return (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-error_subtle bg-error-primary px-4 py-3 text-sm text-error-primary">
            <span>{message}</span>
            <button type="button" aria-label="Dismiss error" onClick={onDismiss} className="rounded p-1 hover:bg-error-primary_hover"><XClose className="size-4" /></button>
        </div>
    );
}

function SocialSection({ tab, data, actions, onOpenCanvas, onAddContact, openContactComposer = false, contactComposerKey = 0, onContactComposerOpenChange }: { tab: string; data: SocialData; actions: SocialActions; onOpenCanvas?: () => void; onAddContact?: () => void; openContactComposer?: boolean; contactComposerKey?: number; onContactComposerOpenChange?: (open: boolean) => void }) {
    if (tab === "overview") return <OverviewSection data={data} actions={actions} onOpenCanvas={onOpenCanvas} />;
    if (tab === "health" || tab === "gifts" || tab === "events") return <SocialIntelligenceWorkspace data={data as SocialIntelligenceData} run={actions.run} pending={actions.pending} onAddContact={onAddContact ?? (() => undefined)} mode={tab === "health" ? "health" : tab === "gifts" ? "gifts" : "events"} hideModeNavigation />;
    if (tab === "canvas") {
        const canvasData: SocialIntelligenceData = {
            contacts: (data.contacts as SocialIntelligenceData["contacts"] | undefined) ?? [],
            connections: data.connections ?? [],
            metrics: data.metrics,
            activity: data.activity,
            gifts: data.gifts,
            upcomingMilestones: data.upcomingMilestones,
            events: data.events as SocialIntelligenceData["events"],
            drafts: data.drafts,
            integrations: data.integrations,
        };
        return (
            <SocialIntelligenceWorkspace data={canvasData} run={actions.run} pending={actions.pending} onAddContact={onAddContact ?? (() => undefined)} mode="map" hideModeNavigation />
        );
    }
    if (tab === "contacts") return <ContactsSection key={`contacts-${contactComposerKey}`} contacts={(data.contacts as ContactRow[] | undefined) ?? []} tags={data.tags ?? []} actions={actions} initialOpen={openContactComposer} onComposerOpenChange={onContactComposerOpenChange} showComposerAction={false} />;
    if (tab === "calendar") return <CalendarSection events={data.events ?? []} annualDates={data.annualDates ?? []} actions={actions} />;
    if (tab === "drafts") return <DraftsSection drafts={data.drafts ?? []} contacts={(data.contacts as ContactRef[] | undefined) ?? []} actions={actions} />;
    if (tab === "events") return <EventsSection events={data.events ?? []} actions={actions} />;
    return <EmptyMessage><Calendar className="mr-2 inline size-4" />Nothing to show in this section.</EmptyMessage>;
}

function OverviewSection({ data, actions, onOpenCanvas }: { data: SocialData; actions: SocialActions; onOpenCanvas?: () => void }) {
    const stats = data.stats ?? { contacts: 0, innerCircle: 0, events: 0, remindersDue: 0 };
    return (
        <div className="flex flex-col gap-5">
            <StatGrid stats={[
                { label: "Contacts", value: stats.contacts, detail: "Active people" },
                { label: "Inner circle", value: stats.innerCircle, detail: "Closest relationships" },
                { label: "Events", value: stats.events, detail: "Saved social events" },
                { label: "Reminders due", value: stats.remindersDue, detail: "Needs attention" },
            ]} />
            {onOpenCanvas && (
                <PersonalCard
                    title="Relationship canvas"
                    action={<button type="button" className={SECONDARY_BUTTON} onClick={onOpenCanvas}><Share07 className="size-4" />Open canvas</button>}
                >
                    <p className="text-sm text-tertiary">
                        Map friends-of-friends, attach Instagram / Snapchat / Discord / TikTok handles, and see degrees of separation from anyone you select — same pan/zoom whiteboard model as Agents.
                    </p>
                </PersonalCard>
            )}
            <div className="grid gap-5 xl:grid-cols-2">
                <BatteryCard entries={data.battery ?? []} actions={actions} />
                <PersonalCard title="Upcoming dates">
                    <PersonalTable
                        rows={data.upcoming ?? []}
                        empty="No birthdays or important dates in the next 60 days."
                        columns={[
                            { key: "name", label: "Person", render: (row) => row.name },
                            { key: "kind", label: "Occasion", render: (row) => row.kind },
                            { key: "when", label: "When", render: (row) => row.days === 0 ? "Today" : `${row.days} days`, align: "right" },
                        ]}
                    />
                </PersonalCard>
            </div>
            <PersonalCard title="Reach out">
                <PersonalTable
                    rows={data.reachOut ?? []}
                    empty="No overdue reach-outs — you’re all caught up."
                    columns={[
                        { key: "name", label: "Person", render: (row) => <PersonCell contact={row} /> },
                        { key: "relationship", label: "Relationship", render: (row) => titleCase(row.relationshipType) },
                        { key: "last", label: "Last contact", render: (row) => formatDate(row.lastContactAt), align: "right" },
                    ]}
                />
            </PersonalCard>
            <PersonalCard title="Recent interactions">
                <PersonalTable
                    rows={data.recentInteractions ?? []}
                    empty="Interactions you log will appear here."
                    columns={[
                        { key: "contact", label: "Contact", render: (row) => row.contactName },
                        { key: "type", label: "Type", render: (row) => titleCase(row.interactionType) },
                        { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
                        { key: "date", label: "Date", render: (row) => formatDate(row.date), align: "right" },
                    ]}
                />
            </PersonalCard>
        </div>
    );
}

function BatteryCard({ entries, actions }: { entries: BatteryRow[]; actions: SocialActions }) {
    const [energy, setEnergy] = useState(5);
    const latest = entries.at(-1);
    const today = localDateValue();
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await actions.run("social:logBattery", {
            date: String(values.get("date") ?? today),
            energyLevel: energy,
            notes: String(values.get("notes") ?? ""),
        });
        if (ok) form.reset();
    };

    return (
        <PersonalCard title="Social battery" action={latest ? <span className="text-xs text-tertiary">Latest: {latest.energyLevel}/10</span> : undefined}>
            <form onSubmit={submit} className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                    <label className={LABEL_CLASS}>Date<input className={INPUT_CLASS} name="date" type="date" defaultValue={today} required /></label>
                    <label className={LABEL_CLASS}>
                        Energy <span className="font-semibold text-primary">{energy}/10</span>
                        <input name="energyLevel" type="range" min="1" max="10" value={energy} onChange={(event) => setEnergy(Number(event.target.value))} className="h-10 accent-[var(--color-brand-600)]" />
                    </label>
                </div>
                <label className={LABEL_CLASS}>Notes<input className={INPUT_CLASS} name="notes" placeholder="What gave or drained energy?" /></label>
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-tertiary">Logging the same date updates that day’s entry.</p>
                    <button className={PRIMARY_BUTTON} type="submit" disabled={actions.pending !== null}>Save check-in</button>
                </div>
            </form>
        </PersonalCard>
    );
}

function ContactsSection({ contacts, tags, actions, initialOpen = false, onComposerOpenChange, showComposerAction = true }: { contacts: ContactRow[]; tags: TagRow[]; actions: SocialActions; initialOpen?: boolean; onComposerOpenChange?: (open: boolean) => void; showComposerAction?: boolean }) {
    const [showForm, setShowForm] = useState(initialOpen);
    const [page, setPage] = useState(1);
    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(contacts.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageContacts = contacts.slice((safePage - 1) * pageSize, safePage * pageSize);
    const setComposerOpen = (open: boolean) => {
        setShowForm(open);
        onComposerOpenChange?.(open);
    };
    useEffect(() => setShowForm(initialOpen), [initialOpen]);
    const remove = async (contact: ContactRow) => {
        if (!window.confirm(`Delete ${contact.displayName}? Their relationship history will also be removed.`)) return;
        await actions.run("social:deleteContact", { id: contact.id });
    };

    return (
        <div className="flex flex-col gap-5">
            <PersonalCard
                title="Contact directory"
                action={showComposerAction ? <button type="button" className={SECONDARY_BUTTON} onClick={() => setComposerOpen(!showForm)}>{showForm ? <XClose className="size-4" /> : <Plus className="size-4" />}{showForm ? "Close" : "Add contact"}</button> : undefined}
            >
                {showForm && <ContactForm tags={tags} actions={actions} onSaved={() => setComposerOpen(false)} />}
                <div className={showForm ? "mt-5 border-t border-secondary pt-5" : ""}>
                    <PersonalTable
                        rows={pageContacts}
                        empty="Add your first contact to start building your relationship history."
                        columns={[
                            { key: "name", label: "Name", render: (row) => <PersonCell contact={row} /> },
                            { key: "relationship", label: "Relationship", render: (row) => titleCase(row.relationshipType) },
                            { key: "company", label: "Company / school", render: (row) => row.companyOrSchool || "—" },
                            { key: "tags", label: "Tags", render: (row) => row.tags?.length ? <span className="flex flex-wrap gap-1">{row.tags.map((tag) => <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border border-secondary px-2 py-0.5 text-[11px] font-medium" style={{ color: tag.color || "var(--c-text-secondary)", background: tag.color ? `color-mix(in srgb, ${tag.color} 10%, transparent)` : "var(--surface-2)" }}><Tag01 className="size-3" />{tag.name}</span>)}</span> : "—" },
                            { key: "direct", label: "Contact directly", render: (row) => <span className="flex min-w-44 flex-col gap-0.5 text-xs"><span className="truncate text-secondary">{row.emails?.[0]?.email || row.phones?.[0]?.phone || "—"}</span>{row.handles?.[0] && <span className="truncate text-quaternary">{row.handles[0].platform}: {row.handles[0].handle}</span>}</span> },
                            { key: "last", label: "Last contact", render: (row) => formatDate(row.lastContactAt), align: "right" },
                            { key: "actions", label: "", render: (row) => <button type="button" className={DANGER_BUTTON} onClick={() => void remove(row)} disabled={actions.pending !== null}><Trash01 className="size-3.5" />Delete</button>, align: "right" },
                        ]}
                    />
                </div>
            </PersonalCard>
            {contacts.length > pageSize && <div className="flex flex-col items-start gap-3 px-1 text-sm text-tertiary sm:flex-row sm:items-center sm:justify-between"><span>{contacts.length} contacts · page {safePage} of {totalPages}</span><div className="flex gap-2"><button type="button" className={SECONDARY_BUTTON} disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button type="button" className={SECONDARY_BUTTON} disabled={safePage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button></div></div>}
        </div>
    );
}

function ContactForm({ tags, actions, onSaved }: { tags: TagRow[]; actions: SocialActions; onSaved: () => void }) {
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await actions.run("social:createContact", {
            displayName: String(values.get("displayName") ?? ""),
            relationshipType: String(values.get("relationshipType") ?? ""),
            howWeMet: String(values.get("howWeMet") ?? ""),
            occupation: String(values.get("occupation") ?? ""),
            companyOrSchool: String(values.get("companyOrSchool") ?? ""),
            currentCity: String(values.get("currentCity") ?? ""),
            timezone: String(values.get("timezone") ?? ""),
            interests: String(values.get("interests") ?? ""),
            birthday: String(values.get("birthday") ?? ""),
            anniversary: String(values.get("anniversary") ?? ""),
            emails: String(values.get("emails") ?? ""),
            phones: String(values.get("phones") ?? ""),
            handles: String(values.get("handles") ?? ""),
            preferredContactMethod: String(values.get("preferredContactMethod") ?? ""),
            notes: String(values.get("notes") ?? ""),
            innerCircle: values.get("innerCircle") === "on",
            stayInTouch: values.get("stayInTouch") === "on",
            stayInTouchDays: String(values.get("stayInTouchDays") ?? "30"),
            tagIds: values.getAll("tagIds").map(String),
        });
        if (ok) {
            form.reset();
            onSaved();
        }
    };

    return (
        <form onSubmit={submit} className="rounded-lg bg-secondary p-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className={LABEL_CLASS}>Display name<input className={INPUT_CLASS} name="displayName" required maxLength={200} placeholder="Alex Morgan" /></label>
                <label className={LABEL_CLASS}>Relationship<input className={INPUT_CLASS} name="relationshipType" placeholder="Friend, family, colleague…" /></label>
                <label className={LABEL_CLASS}>How we met<input className={INPUT_CLASS} name="howWeMet" placeholder="Through Sam, college, climbing gym…" maxLength={1000} /></label>
                <label className={LABEL_CLASS}>Occupation<input className={INPUT_CLASS} name="occupation" placeholder="Product designer" /></label>
                <label className={LABEL_CLASS}>Company / school<input className={INPUT_CLASS} name="companyOrSchool" /></label>
                <label className={LABEL_CLASS}>Current city<input className={INPUT_CLASS} name="currentCity" placeholder="Brooklyn, NY" /></label>
                <label className={LABEL_CLASS}>Time zone<input className={INPUT_CLASS} name="timezone" placeholder="America/New_York" /></label>
                <label className={LABEL_CLASS}>Birthday<input className={INPUT_CLASS} name="birthday" type="date" /></label>
                <label className={LABEL_CLASS}>Anniversary<input className={INPUT_CLASS} name="anniversary" type="date" /></label>
                <label className={LABEL_CLASS}>Emails<textarea className={`${INPUT_CLASS} min-h-20 resize-y`} name="emails" placeholder={'alex@example.com\nwork@example.com'} /></label>
                <label className={LABEL_CLASS}>Phones<textarea className={`${INPUT_CLASS} min-h-20 resize-y`} name="phones" placeholder={'+1 555 010 2000\n+1 555 010 2001'} /></label>
                <label className={LABEL_CLASS}>Social connections<textarea className={`${INPUT_CLASS} min-h-20 resize-y`} name="handles" placeholder={'Instagram: @alex\nLinkedIn: alex-morgan'} /></label>
                <label className={LABEL_CLASS}>Preferred contact method<RichSelect name="preferredContactMethod" placeholder="Not set" options={[{ value: "text", label: "Text" }, { value: "call", label: "Call" }, { value: "email", label: "Email" }, { value: "dm", label: "Direct message" }]} /></label>
                <label className={LABEL_CLASS}>Reach-out cadence (days)<input className={INPUT_CLASS} name="stayInTouchDays" type="number" min="1" max="3650" defaultValue="30" /></label>
                <label className={`${LABEL_CLASS} md:col-span-2`}>Preferences & interests<input className={INPUT_CLASS} name="interests" placeholder="Dietary needs, favorite food, hobbies, sizes…" /></label>
                <label className={`${LABEL_CLASS} md:col-span-2 xl:col-span-1`}>Notes<input className={INPUT_CLASS} name="notes" /></label>
            </div>
            {tags.length > 0 && (
                <fieldset className="mt-4">
                    <legend className="mb-2 text-xs font-medium text-secondary">Tags</legend>
                    <div className="flex flex-wrap gap-2">{tags.map((tag) => <label key={tag.id} className="inline-flex items-center gap-2 rounded-full border border-secondary bg-primary px-3 py-1.5 text-xs font-medium" style={{ color: tag.color || "var(--c-text-secondary)" }}><input name="tagIds" type="checkbox" value={tag.id} /><Tag01 className="size-3.5" />{tag.name}</label>)}</div>
                </fieldset>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4 text-sm text-secondary">
                    <label className="inline-flex items-center gap-2"><input name="innerCircle" type="checkbox" /> Inner circle</label>
                    <label className="inline-flex items-center gap-2"><input name="stayInTouch" type="checkbox" /> Track reach-outs</label>
                </div>
                <button className={PRIMARY_BUTTON} type="submit" disabled={actions.pending !== null}>Create contact</button>
            </div>
        </form>
    );
}

function TagsCard({ tags, actions }: { tags: TagRow[]; actions: SocialActions }) {
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await actions.run("social:createTag", { name: String(values.get("name") ?? ""), color: String(values.get("color") ?? "") });
        if (ok) form.reset();
    };
    const remove = async (tag: TagRow) => {
        if (!window.confirm(`Delete the “${tag.name}” tag? Contacts will stay in your directory.`)) return;
        await actions.run("social:deleteTag", { id: tag.id });
    };

    return (
        <PersonalCard title="Contact tags">
            <form onSubmit={submit} className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className={`${LABEL_CLASS} flex-1`}>Tag name<input className={INPUT_CLASS} name="name" required maxLength={80} placeholder="Running club" /></label>
                <label className={LABEL_CLASS}>Color<input className={`${INPUT_CLASS} h-10 w-20 p-1`} name="color" type="color" defaultValue="#7f56d9" /></label>
                <button className={SECONDARY_BUTTON} type="submit" disabled={actions.pending !== null}><Plus className="size-4" />Add tag</button>
            </form>
            {tags.length === 0 ? <EmptyMessage>Create tags to group contacts.</EmptyMessage> : (
                <div className="flex flex-wrap gap-2">{tags.map((tag) => (
                    <span key={tag.id} className="inline-flex items-center gap-2 rounded-full border border-secondary bg-primary px-3 py-1.5 text-xs text-secondary">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color || "#98a2b3" }} />
                        {tag.name}{tag.contactCount != null && <span className="text-quaternary">{tag.contactCount}</span>}
                        <button type="button" aria-label={`Delete ${tag.name} tag`} onClick={() => void remove(tag)} disabled={actions.pending !== null} className="rounded p-0.5 text-quaternary hover:text-error-primary"><XClose className="size-3" /></button>
                    </span>
                ))}</div>
            )}
        </PersonalCard>
    );
}

function CalendarSection({ events, annualDates, actions }: { events: EventRow[]; annualDates: NonNullable<SocialData["annualDates"]>; actions: SocialActions }) {
    return (
        <div className="grid gap-5 xl:grid-cols-2">
            <EventTable title="Social events" events={events} actions={actions} />
            <PersonalCard title="Birthdays & annual dates">
                <PersonalTable
                    rows={annualDates}
                    empty="Add birthdays or contact dates to see them here."
                    columns={[
                        { key: "contact", label: "Contact", render: (row) => row.contactName },
                        { key: "kind", label: "Occasion", render: (row) => row.kind },
                        { key: "date", label: "Date", render: (row) => formatDate(row.date), align: "right" },
                    ]}
                />
            </PersonalCard>
        </div>
    );
}

function EventsSection({ events, actions }: { events: EventRow[]; actions: SocialActions }) {
    const [showForm, setShowForm] = useState(false);
    return (
        <div className="flex flex-col gap-5">
            <PersonalCard
                title="Create an event"
                action={<button type="button" className={SECONDARY_BUTTON} onClick={() => setShowForm((value) => !value)}>{showForm ? <XClose className="size-4" /> : <Plus className="size-4" />}{showForm ? "Close" : "New event"}</button>}
            >
                {showForm ? <EventForm actions={actions} onSaved={() => setShowForm(false)} /> : <p className="text-sm text-tertiary">Save plans, occasions, and memories without leaving Coretex.</p>}
            </PersonalCard>
            <EventTable title="Events" events={events} actions={actions} />
        </div>
    );
}

function EventForm({ actions, onSaved }: { actions: SocialActions; onSaved: () => void }) {
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const ok = await actions.run("social:createEvent", {
            name: String(values.get("name") ?? ""),
            eventDate: String(values.get("eventDate") ?? ""),
            location: String(values.get("location") ?? ""),
            attendees: String(values.get("attendees") ?? ""),
            notes: String(values.get("notes") ?? ""),
        });
        if (ok) {
            form.reset();
            onSaved();
        }
    };
    return (
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <label className={LABEL_CLASS}>Event name<input className={INPUT_CLASS} name="name" required maxLength={200} /></label>
            <label className={LABEL_CLASS}>Date and time<input className={INPUT_CLASS} name="eventDate" type="datetime-local" /></label>
            <label className={LABEL_CLASS}>Location<input className={INPUT_CLASS} name="location" /></label>
            <label className={LABEL_CLASS}>Attendees<input className={INPUT_CLASS} name="attendees" placeholder="Comma-separated names" /></label>
            <label className={`${LABEL_CLASS} md:col-span-2`}>Notes<textarea className={`${INPUT_CLASS} min-h-20 resize-y`} name="notes" /></label>
            <div className="md:col-span-2 flex justify-end"><button className={PRIMARY_BUTTON} type="submit" disabled={actions.pending !== null}>Create event</button></div>
        </form>
    );
}

function EventTable({ title, events, actions }: { title: string; events: EventRow[]; actions: SocialActions }) {
    const remove = async (event: EventRow) => {
        if (!window.confirm(`Delete “${event.name}”?`)) return;
        await actions.run("social:deleteEvent", { id: event.id });
    };
    return (
        <PersonalCard title={title}>
            <PersonalTable
                rows={events}
                empty="No social events saved yet."
                columns={[
                    { key: "event", label: "Event", render: (row) => <EventCell event={row} /> },
                    { key: "location", label: "Location", render: (row) => row.location || "—" },
                    { key: "date", label: "Date", render: (row) => formatDate(row.eventDate), align: "right" },
                    { key: "actions", label: "", render: (row) => <button type="button" className={DANGER_BUTTON} onClick={() => void remove(row)} disabled={actions.pending !== null}><Trash01 className="size-3.5" />Delete</button>, align: "right" },
                ]}
            />
        </PersonalCard>
    );
}

function DraftsSection({ drafts, contacts, actions }: { drafts: DraftRow[]; contacts: ContactRef[]; actions: SocialActions }) {
    const [editing, setEditing] = useState<DraftRow | null>(null);
    const [showForm, setShowForm] = useState(false);
    const openNew = () => { setEditing(null); setShowForm(true); };
    const openEdit = (draft: DraftRow) => { setEditing(draft); setShowForm(true); };
    const remove = async (draft: DraftRow) => {
        if (!window.confirm("Delete this outreach draft?")) return;
        const ok = await actions.run("social:deleteDraft", { id: draft.id });
        if (ok && editing?.id === draft.id) { setEditing(null); setShowForm(false); }
    };

    return (
        <PersonalCard
            title="Outreach drafts"
            action={<button type="button" className={SECONDARY_BUTTON} onClick={showForm ? () => { setShowForm(false); setEditing(null); } : openNew}>{showForm ? <XClose className="size-4" /> : <Plus className="size-4" />}{showForm ? "Close" : "New draft"}</button>}
        >
            {showForm && <DraftForm key={editing?.id ?? "new"} draft={editing} contacts={contacts} actions={actions} onSaved={() => { setEditing(null); setShowForm(false); }} />}
            <div className={showForm ? "mt-5 border-t border-secondary pt-5" : ""}>
                <PersonalTable
                    rows={drafts}
                    empty="No outreach drafts yet."
                    columns={[
                        { key: "contact", label: "Contact", render: (row) => row.contactName || "Unassigned" },
                        { key: "channel", label: "Channel", render: (row) => titleCase(row.channel) },
                        { key: "body", label: "Draft", render: (row) => <span className="line-clamp-2 max-w-xl">{row.body}</span> },
                        { key: "due", label: "Due", render: (row) => formatDate(row.dueAt), align: "right" },
                        { key: "actions", label: "", render: (row) => <div className="flex justify-end gap-1"><button type="button" className={SECONDARY_BUTTON} onClick={() => openEdit(row)} disabled={actions.pending !== null}><Edit01 className="size-3.5" />Edit</button><button type="button" className={DANGER_BUTTON} onClick={() => void remove(row)} disabled={actions.pending !== null}><Trash01 className="size-3.5" />Delete</button></div>, align: "right" },
                    ]}
                />
            </div>
        </PersonalCard>
    );
}

function DraftForm({ draft, contacts, actions, onSaved }: { draft: DraftRow | null; contacts: ContactRef[]; actions: SocialActions; onSaved: () => void }) {
    const [contactId, setContactId] = useState(draft?.contactId ?? "");
    const [channel, setChannel] = useState(draft?.channel ?? "text");
    const [body, setBody] = useState(draft?.body ?? "");
    const [brief, setBrief] = useState("");
    const [styleSample, setStyleSample] = useState("");
    const [assisting, setAssisting] = useState(false);

    useEffect(() => {
        try { setStyleSample(window.localStorage.getItem("coretex-social-writing-style") ?? ""); } catch { /* storage may be unavailable */ }
    }, []);

    const assist = async () => {
        if (!brief.trim()) return;
        setAssisting(true);
        try {
            try { window.localStorage.setItem("coretex-social-writing-style", styleSample.trim()); } catch { /* storage may be unavailable */ }
            const result = await actions.request("social:assistDraft", { brief, styleSample, contactId, channel }) as { body?: string } | null;
            if (result?.body) setBody(result.body);
        } finally {
            setAssisting(false);
        }
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const payload = {
            ...(draft ? { id: draft.id } : {}),
            contactId,
            channel,
            body,
            dueAt: String(values.get("dueAt") ?? ""),
        };
        const ok = await actions.run(draft ? "social:updateDraft" : "social:createDraft", payload);
        if (ok) onSaved();
    };
    return (
        <form onSubmit={submit} className="rounded-lg bg-secondary p-4">
            <div className="mb-4 rounded-xl border border-brand bg-primary p-4">
                <div className="mb-3 flex items-start gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-primary text-brand-secondary"><Stars01 className="size-4" /></span>
                    <div><p className="text-sm font-semibold text-primary">Draft with your voice</p><p className="text-xs text-tertiary">Describe the reply, then optionally paste a real message you wrote so local AI can match your cadence, tone, punctuation, and emoji habits.</p></div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                    <label className={LABEL_CLASS}>What should this message say?<textarea className={`${INPUT_CLASS} min-h-24 resize-y`} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Thank them for dinner and suggest next Thursday…" /></label>
                    <label className={LABEL_CLASS}>Your writing sample<textarea className={`${INPUT_CLASS} min-h-24 resize-y`} value={styleSample} onChange={(event) => setStyleSample(event.target.value)} placeholder="Paste a text you sent before. It stays in this local app." /></label>
                </div>
                <div className="mt-3 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-tertiary">The most recent sample is remembered for future drafts.</p><button type="button" className={SECONDARY_BUTTON} onClick={() => void assist()} disabled={!brief.trim() || assisting || actions.pending !== null}><Stars01 className="size-4" />{assisting ? "Drafting…" : "Draft with AI"}</button></div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
                <label className={LABEL_CLASS}>Contact<RichSelect name="contactId" value={contactId} onChange={(event) => setContactId(event.target.value)} placeholder="Unassigned" options={contacts.map((contact) => ({ value: contact.id, label: contact.displayName }))} /></label>
                <label className={LABEL_CLASS}>Channel<RichSelect name="channel" value={channel} onChange={(event) => setChannel(event.target.value)} options={[{ value: "text", label: "Text" }, { value: "email", label: "Email" }, { value: "dm", label: "Direct message" }, { value: "call", label: "Call" }]} /></label>
                <label className={LABEL_CLASS}>Send by<input className={INPUT_CLASS} name="dueAt" type="datetime-local" defaultValue={dateTimeInput(draft?.dueAt)} /></label>
                <label className={`${LABEL_CLASS} md:col-span-3`}>Message<textarea className={`${INPUT_CLASS} min-h-28 resize-y`} name="body" required maxLength={20000} value={body} onChange={(event) => setBody(event.target.value)} /></label>
            </div>
            <div className="mt-4 flex justify-end"><button className={PRIMARY_BUTTON} type="submit" disabled={actions.pending !== null}>{draft ? "Update draft" : "Create draft"}</button></div>
        </form>
    );
}

function localDateValue() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function dateTimeInput(value: string | null | undefined) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default SocialView;
