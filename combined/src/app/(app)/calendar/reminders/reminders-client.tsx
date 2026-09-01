"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
    addDays,
    addMonths,
    differenceInCalendarDays,
    endOfDay,
    formatDistanceToNowStrict,
    isToday,
    startOfDay,
} from "date-fns";
import {
    Bell01,
    Calendar,
    Check,
    ChevronDown,
    ChevronRight,
    Clock,
    LinkExternal01,
    MarkerPin01,
    Phone,
    Plus,
    Trash02,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";
import {
    Card,
    Field,
    FormModal,
    NativeInput,
    NativeSelect,
    NativeTextarea,
} from "../_components/calendar-ui";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { formatDate } from "@/lib/dates";
import { reminderIcon } from "@/components/application/reminders/icon-registry";
import { IconPicker } from "@/components/application/icon-picker/icon-picker";
import {
    archiveReminder,
    completeReminder,
    createReminder,
    deleteReminder,
    snoozeReminder,
    updateReminder,
} from "@/lib/actions/reminders";

type Cadence = "ONCE" | "EVERY_N_DAYS" | "WEEKLY" | "MONTHLY_ON_DAY" | "EVERY_N_MONTHS";

export interface ReminderRow {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    icon: string | null;
    cadence: Cadence;
    intervalN: number | null;
    dayOfMonth: number | null;
    nextDueAt: string;
    lastCompletedAt: string | null;
    archived: boolean;
    link: string | null;
    phone: string | null;
    contact: { id: string; displayName: string; avatarUrl: string | null } | null;
}

interface ContactOption {
    id: string;
    displayName: string;
}

const ORDINAL = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function cadenceSummary(r: Pick<ReminderRow, "cadence" | "intervalN" | "dayOfMonth" | "nextDueAt">): string {
    switch (r.cadence) {
        case "ONCE":
            return "One time";
        case "EVERY_N_DAYS": {
            const n = r.intervalN ?? 1;
            return n === 1 ? "Every day" : `Every ${n} days`;
        }
        case "WEEKLY":
            return "Weekly";
        case "MONTHLY_ON_DAY": {
            const day = r.dayOfMonth ?? new Date(r.nextDueAt).getDate();
            return `Monthly on the ${ORDINAL(day)}`;
        }
        case "EVERY_N_MONTHS": {
            const n = r.intervalN ?? 1;
            return n === 1 ? "Every month" : `Every ${n} months`;
        }
        default:
            return "";
    }
}

function relativeDue(iso: string): { text: string; overdue: boolean } {
    const due = new Date(iso);
    const days = differenceInCalendarDays(due, new Date());
    if (days < 0) return { text: `${formatDistanceToNowStrict(due)} overdue`, overdue: true };
    if (days === 0) return { text: "Due today", overdue: false };
    return { text: `in ${formatDistanceToNowStrict(due)}`, overdue: false };
}

async function run(action: (fd: FormData) => Promise<unknown>, fd: FormData, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}

function toLocalInput(iso: string) {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

type Bucket = "overdue" | "today" | "upcoming" | "later";

export function RemindersClient({ reminders, contacts }: { reminders: ReminderRow[]; contacts: ContactOption[] }) {
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<ReminderRow | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [showArchived, setShowArchived] = useState(false);

    const groups = useMemo(() => {
        const now = new Date();
        const todayEnd = endOfDay(now);
        const in30 = endOfDay(addDays(now, 30));
        const out: Record<Bucket, ReminderRow[]> = { overdue: [], today: [], upcoming: [], later: [] };
        const archived: ReminderRow[] = [];
        for (const r of reminders) {
            if (r.archived) {
                archived.push(r);
                continue;
            }
            const due = new Date(r.nextDueAt);
            if (due < startOfDay(now)) out.overdue.push(r);
            else if (due <= todayEnd) out.today.push(r);
            else if (due <= in30) out.upcoming.push(r);
            else out.later.push(r);
        }
        return { ...out, archived };
    }, [reminders]);

    function openNew() {
        setEditing(null);
        setModalOpen(true);
    }
    function openEdit(r: ReminderRow) {
        setEditing(r);
        setModalOpen(true);
    }
    function toggleExpand(id: string) {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    const sections: Array<{ key: Bucket; label: string; accent: boolean; items: ReminderRow[] }> = [
        { key: "overdue", label: "Overdue", accent: true, items: groups.overdue },
        { key: "today", label: "Today", accent: false, items: groups.today },
        { key: "upcoming", label: "Upcoming · next 30 days", accent: false, items: groups.upcoming },
        { key: "later", label: "Later", accent: false, items: groups.later },
    ];

    const activeCount = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.later.length;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-tertiary">
                    {activeCount} active reminder{activeCount === 1 ? "" : "s"}
                </p>
                <Button size="sm" iconLeading={Plus} onClick={openNew}>
                    New reminder
                </Button>
            </div>

            {activeCount === 0 && groups.archived.length === 0 ? (
                <Card className="flex flex-col items-center gap-3 py-10 text-center">
                    <FeaturedIcon icon={Bell01} color="brand" theme="light" size="lg" />
                    <div className="flex flex-col gap-1">
                        <p className="text-md font-semibold text-primary">No reminders yet</p>
                        <p className="text-sm text-tertiary">Track recurring errands like haircuts, dentist visits and bill payments.</p>
                    </div>
                    <Button size="sm" iconLeading={Plus} onClick={openNew}>
                        Create your first reminder
                    </Button>
                </Card>
            ) : (
                <div className="flex flex-col gap-6">
                    {sections.map((s) =>
                        s.items.length === 0 ? null : (
                            <section key={s.key} className="flex flex-col gap-2">
                                <h2 className={cx("text-sm font-semibold", s.accent ? "text-error-primary" : "text-secondary")}>
                                    {s.label}
                                    <span className="ml-2 font-normal text-tertiary">{s.items.length}</span>
                                </h2>
                                <Card className="divide-y divide-border-secondary p-0">
                                    {s.items.map((r) => (
                                        <ReminderRowView
                                            key={r.id}
                                            reminder={r}
                                            accent={s.accent}
                                            expanded={expanded.has(r.id)}
                                            onToggle={() => toggleExpand(r.id)}
                                            onEdit={() => openEdit(r)}
                                        />
                                    ))}
                                </Card>
                            </section>
                        ),
                    )}

                    {groups.archived.length > 0 && (
                        <section className="flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={() => setShowArchived((v) => !v)}
                                className="flex items-center gap-1.5 text-sm font-semibold text-secondary transition hover:text-primary"
                                aria-expanded={showArchived}
                            >
                                {showArchived ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                                Archived
                                <span className="ml-1 font-normal text-tertiary">{groups.archived.length}</span>
                            </button>
                            {showArchived && (
                                <Card className="divide-y divide-border-secondary p-0">
                                    {groups.archived.map((r) => (
                                        <ReminderRowView
                                            key={r.id}
                                            reminder={r}
                                            accent={false}
                                            expanded={expanded.has(r.id)}
                                            onToggle={() => toggleExpand(r.id)}
                                            onEdit={() => openEdit(r)}
                                        />
                                    ))}
                                </Card>
                            )}
                        </section>
                    )}
                </div>
            )}

            <ReminderModal
                key={editing?.id ?? "new"}
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                editing={editing}
                contacts={contacts}
            />
        </div>
    );
}

function ReminderRowView({
    reminder: r,
    accent,
    expanded,
    onToggle,
    onEdit,
}: {
    reminder: ReminderRow;
    accent: boolean;
    expanded: boolean;
    onToggle: () => void;
    onEdit: () => void;
}) {
    const Icon = reminderIcon(r.icon);
    const rel = relativeDue(r.nextDueAt);
    const due = new Date(r.nextDueAt);

    return (
        <div className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
                <FeaturedIcon icon={Icon} color={accent && rel.overdue ? "error" : "brand"} theme="light" size="md" />

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-left" aria-expanded={expanded}>
                        <span className="truncate text-sm font-semibold text-primary">{r.title}</span>
                        {(r.description || r.location || r.contact || r.phone || r.link) && (
                            <ChevronDown className={cx("size-3.5 shrink-0 text-fg-quaternary transition", expanded && "rotate-180")} aria-hidden="true" />
                        )}
                    </button>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
                        <span className="inline-flex items-center gap-1">
                            <Clock className="size-3.5" aria-hidden="true" /> {cadenceSummary(r)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <Calendar className="size-3.5" aria-hidden="true" /> {formatDate(due)}
                        </span>
                        <span className={cx("font-medium", rel.overdue ? "text-error-primary" : isToday(due) ? "text-brand-secondary" : "text-tertiary")}>
                            {rel.text}
                        </span>
                    </div>

                    {/* chips */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        {r.location && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary">
                                <MarkerPin01 className="size-3" aria-hidden="true" /> {r.location}
                            </span>
                        )}
                        {r.contact ? (
                            <Link
                                href={`/social/contacts/${r.contact.id}`}
                                className="inline-flex items-center gap-1.5 rounded-full bg-secondary py-0.5 pr-2.5 pl-0.5 text-xs text-secondary transition hover:bg-secondary_hover"
                            >
                                <Avatar size="xs" src={r.contact.avatarUrl ?? undefined} initials={r.contact.displayName.slice(0, 2).toUpperCase()} alt={r.contact.displayName} />
                                {r.contact.displayName}
                            </Link>
                        ) : (
                            r.phone && (
                                <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary transition hover:bg-secondary_hover">
                                    <Phone className="size-3" aria-hidden="true" /> {r.phone}
                                </a>
                            )
                        )}
                        {r.link && (
                            <a
                                href={r.link}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-brand-secondary transition hover:bg-secondary_hover"
                            >
                                <LinkExternal01 className="size-3" aria-hidden="true" /> Link
                            </a>
                        )}
                    </div>
                </div>

                {/* actions */}
                <div className="flex shrink-0 items-center gap-1.5">
                    {!r.archived && (
                        <>
                            <Button
                                size="sm"
                                color="secondary"
                                iconLeading={Check}
                                onClick={async () => {
                                    const fd = new FormData();
                                    fd.set("id", r.id);
                                    await run(completeReminder, fd, "Marked done");
                                }}
                            >
                                Done
                            </Button>
                            <Dropdown.Root>
                                <Button size="sm" color="tertiary" iconLeading={Clock} aria-label="Snooze" />
                                <Dropdown.Popover>
                                    <Dropdown.Menu>
                                        <Dropdown.Item
                                            label="Snooze 1 day"
                                            selectionIndicator="none"
                                            onAction={async () => {
                                                const fd = new FormData();
                                                fd.set("id", r.id);
                                                fd.set("days", "1");
                                                await run(snoozeReminder, fd, "Snoozed 1 day");
                                            }}
                                        />
                                        <Dropdown.Item
                                            label="Snooze 7 days"
                                            selectionIndicator="none"
                                            onAction={async () => {
                                                const fd = new FormData();
                                                fd.set("id", r.id);
                                                fd.set("days", "7");
                                                await run(snoozeReminder, fd, "Snoozed 7 days");
                                            }}
                                        />
                                    </Dropdown.Menu>
                                </Dropdown.Popover>
                            </Dropdown.Root>
                        </>
                    )}
                    <Dropdown.Root>
                        <Dropdown.DotsButton />
                        <Dropdown.Popover>
                            <Dropdown.Menu>
                                <Dropdown.Item label="Edit" selectionIndicator="none" onAction={onEdit} />
                                <Dropdown.Item
                                    label={r.archived ? "Unarchive" : "Archive"}
                                    selectionIndicator="none"
                                    onAction={async () => {
                                        const fd = new FormData();
                                        fd.set("id", r.id);
                                        fd.set("archived", r.archived ? "false" : "true");
                                        await run(archiveReminder, fd, r.archived ? "Unarchived" : "Archived");
                                    }}
                                />
                                <Dropdown.Item
                                    label="Delete"
                                    selectionIndicator="none"
                                    onAction={async () => {
                                        const fd = new FormData();
                                        fd.set("id", r.id);
                                        await run(deleteReminder, fd, "Deleted");
                                    }}
                                />
                            </Dropdown.Menu>
                        </Dropdown.Popover>
                    </Dropdown.Root>
                </div>
            </div>

            {expanded && (r.description || r.lastCompletedAt) && (
                <div className="ml-13 flex flex-col gap-1 border-l-2 border-secondary pl-3 text-sm text-tertiary">
                    {r.description && <p className="whitespace-pre-wrap">{r.description}</p>}
                    {r.lastCompletedAt && <p className="text-xs">Last completed {formatDate(r.lastCompletedAt)}</p>}
                </div>
            )}
        </div>
    );
}

function ReminderModal({
    open,
    onClose,
    editing,
    contacts,
}: {
    open: boolean;
    onClose: () => void;
    editing: ReminderRow | null;
    contacts: ContactOption[];
}) {
    const [cadence, setCadence] = useState<Cadence>(editing?.cadence ?? "EVERY_N_MONTHS");
    const [icon, setIcon] = useState<string>(editing?.icon ?? "Bell01");
    const [linkMode, setLinkMode] = useState<"contact" | "phone">(editing?.phone && !editing?.contact ? "phone" : "contact");
    const [contactId, setContactId] = useState<string>(editing?.contact?.id ?? "");
    const [phone, setPhone] = useState<string>(editing?.phone ?? "");
    const [intervalN, setIntervalN] = useState<string>(String(editing?.intervalN ?? (editing?.cadence === "EVERY_N_DAYS" ? 7 : 3)));
    const [dayOfMonth, setDayOfMonth] = useState<string>(String(editing?.dayOfMonth ?? new Date(editing?.nextDueAt ?? Date.now()).getDate()));

    const dueDefault = editing ? toLocalInput(editing.nextDueAt) : toLocalInput(addMonths(new Date(), 1).toISOString());

    async function onSubmit(fd: FormData) {
        fd.set("cadence", cadence);
        fd.set("icon", icon);
        if (linkMode === "contact") {
            fd.set("contactId", contactId);
            fd.set("phone", "");
        } else {
            fd.set("contactId", "");
            fd.set("phone", phone);
        }
        if (cadence === "EVERY_N_DAYS" || cadence === "EVERY_N_MONTHS") fd.set("intervalN", intervalN);
        if (cadence === "MONTHLY_ON_DAY") fd.set("dayOfMonth", dayOfMonth);
        const ok = await run(editing ? updateReminder : createReminder, fd, editing ? "Updated" : "Created");
        if (ok) onClose();
    }

    const cadenceOptions: Array<{ value: Cadence; label: string }> = [
        { value: "ONCE", label: "Once" },
        { value: "EVERY_N_DAYS", label: "Every N days" },
        { value: "WEEKLY", label: "Weekly" },
        { value: "MONTHLY_ON_DAY", label: "Monthly on day" },
        { value: "EVERY_N_MONTHS", label: "Every N months" },
    ];

    return (
        <FormModal isOpen={open} onOpenChange={(o) => !o && onClose()} title={editing ? "Edit reminder" : "New reminder"}>
            <form action={onSubmit} className="flex flex-col gap-4">
                {editing && <input type="hidden" name="id" value={editing.id} />}

                <Field label="Title" htmlFor="title" required>
                    <NativeInput id="title" name="title" defaultValue={editing?.title} placeholder="e.g. Haircut" required />
                </Field>

                <Field label="Description" htmlFor="description">
                    <NativeTextarea id="description" name="description" defaultValue={editing?.description ?? ""} placeholder="Optional notes" />
                </Field>

                <Field label="Location" htmlFor="location">
                    <NativeInput id="location" name="location" defaultValue={editing?.location ?? ""} placeholder="e.g. Downtown Barbers" />
                </Field>

                {/* Icon picker */}
                <Field label="Icon">
                    <IconPicker value={icon} onChange={setIcon} />
                </Field>

                {/* Contact or phone */}
                <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                        {(["contact", "phone"] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setLinkMode(m)}
                                className={cx(
                                    "flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                                    linkMode === m ? "border-brand bg-brand-primary text-brand-secondary" : "border-secondary text-tertiary hover:text-secondary",
                                )}
                            >
                                {m === "contact" ? "Linked contact" : "Phone number"}
                            </button>
                        ))}
                    </div>
                    {linkMode === "contact" ? (
                        <NativeSelect value={contactId} onChange={(e) => setContactId(e.target.value)} aria-label="Contact">
                            <option value="">No contact</option>
                            {contacts.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.displayName}
                                </option>
                            ))}
                        </NativeSelect>
                    ) : (
                        <NativeInput type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" aria-label="Phone number" />
                    )}
                </div>

                <Field label="Link" htmlFor="link">
                    <NativeInput id="link" name="link" type="url" defaultValue={editing?.link ?? ""} placeholder="https://" />
                </Field>

                {/* Cadence */}
                <Field label="Frequency">
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {cadenceOptions.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setCadence(opt.value)}
                                className={cx(
                                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                                    cadence === opt.value ? "border-brand bg-brand-primary text-brand-secondary" : "border-secondary text-tertiary hover:text-secondary",
                                )}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </Field>

                {(cadence === "EVERY_N_DAYS" || cadence === "EVERY_N_MONTHS") && (
                    <Field label={cadence === "EVERY_N_DAYS" ? "Repeat every (days)" : "Repeat every (months)"}>
                        <NativeInput type="number" min={1} value={intervalN} onChange={(e) => setIntervalN(e.target.value)} className="w-32" />
                    </Field>
                )}

                {cadence === "MONTHLY_ON_DAY" && (
                    <Field label="Day of month" hint="1–31, clamped to the last day of shorter months.">
                        <NativeInput type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className="w-32" />
                    </Field>
                )}

                <FormDateInput name="nextDueAt" label="First due" variant="datetime" isRequired defaultValue={dueDefault} />


                <div className="flex justify-end gap-2 pt-2">
                    <Button color="secondary" type="button" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit">{editing ? "Save" : "Create"}</Button>
                </div>
            </form>
        </FormModal>
    );
}
