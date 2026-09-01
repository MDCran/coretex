// @ts-nocheck
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy01, Check, Send01, Edit01, X, Archive, MessageTextSquare01, PenTool02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Avatar } from "@/components/base/avatar/avatar";
import { Select } from "@/components/base/select/select";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { TextareaInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/social/ui";
import { useClipboard } from "@/hooks/use-clipboard";
import { cx } from "@/utils/cx";

export type DraftContact = { id: string; displayName: string; avatarKey: string | null; avatarUrl: string | null };

export type DraftItem = {
    id: string;
    contactId: string | null;
    contact: DraftContact | null;
    channel: string | null;
    body: string;
    dueAt: string | null;
    sentAt: string | null;
};

const CHANNELS: { value: string; label: string }[] = [
    { value: "TEXT", label: "Text" },
    { value: "EMAIL", label: "Email" },
    { value: "DM", label: "DM" },
    { value: "CALL", label: "Call" },
];

const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.value, c.label]));

const QUICK_DEADLINES: { label: string; days: number }[] = [
    { label: "1d", days: 1 },
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
];

/** yyyy-MM-ddTHH:mm for a datetime-local value N days from now (end of that day). */
function deadlineFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(17, 0, 0, 0);
    return toLocalInput(d);
}

function toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function countdown(dueAt: string | null): { text: string; overdue: boolean } | null {
    if (!dueAt) return null;
    const due = new Date(dueAt).getTime();
    const now = Date.now();
    const dayMs = 86_400_000;
    const diffDays = Math.round((due - now) / dayMs);
    if (due < now) {
        const od = Math.max(1, Math.abs(diffDays));
        return { text: `${od}d overdue`, overdue: true };
    }
    if (diffDays === 0) return { text: "Due today", overdue: false };
    return { text: `Due in ${diffDays}d`, overdue: false };
}

type Actions = {
    createAction: (formData: FormData) => Promise<void>;
    updateAction: (formData: FormData) => Promise<void>;
    markSentAction: (formData: FormData) => Promise<void>;
    archiveAction: (formData: FormData) => Promise<void>;
    deleteAction: (formData: FormData) => Promise<void>;
};

export function DraftsManager({
    drafts,
    contacts,
    actions,
}: {
    drafts: DraftItem[];
    contacts: DraftContact[];
    actions: Actions;
}) {
    const [editing, setEditing] = useState<DraftItem | null>(null);

    const groups = useMemo(() => {
        const overdue: DraftItem[] = [];
        const dueSoon: DraftItem[] = [];
        const noDeadline: DraftItem[] = [];
        const sent: DraftItem[] = [];
        const now = Date.now();
        for (const d of drafts) {
            if (d.sentAt) {
                sent.push(d);
            } else if (!d.dueAt) {
                noDeadline.push(d);
            } else if (new Date(d.dueAt).getTime() < now) {
                overdue.push(d);
            } else {
                dueSoon.push(d);
            }
        }
        return { overdue, dueSoon, noDeadline, sent };
    }, [drafts]);

    const isEmpty = drafts.length === 0;

    return (
        <div className="flex flex-col gap-6">
            <ComposeCard contacts={contacts} createAction={actions.createAction} />

            {isEmpty ? (
                <Card>
                    <EmptyState
                        icon={PenTool02}
                        title="No drafts yet"
                        description="Draft a message above and set a deadline. We'll keep it front and center until it's sent, so the right words are always ready."
                    />
                </Card>
            ) : (
                <>
                    <Group title="Overdue" items={groups.overdue} actions={actions} onEdit={setEditing} />
                    <Group title="Due soon" items={groups.dueSoon} actions={actions} onEdit={setEditing} />
                    <Group title="No deadline" items={groups.noDeadline} actions={actions} onEdit={setEditing} />
                    <Group title="Sent" items={groups.sent} actions={actions} onEdit={setEditing} muted />
                </>
            )}

            {editing && (
                <EditDialog
                    draft={editing}
                    contacts={contacts}
                    updateAction={actions.updateAction}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
}

function ContactSelect({ contacts, value, onChange }: { contacts: DraftContact[]; value: string | null; onChange: (id: string | null) => void }) {
    const items = contacts.map((c) => ({ id: c.id, label: c.displayName, avatarUrl: c.avatarUrl ?? undefined }));
    return (
        <Select.ComboBox
            label="Contact"
            placeholder="Search contacts (optional)"
            items={items}
            selectedKey={value}
            onSelectionChange={(key) => onChange(key ? String(key) : null)}
            size="sm"
        >
            {(item) => (
                <Select.Item id={item.id} avatarUrl={item.avatarUrl}>
                    {item.label}
                </Select.Item>
            )}
        </Select.ComboBox>
    );
}

function ChannelChips({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-secondary">Channel</span>
            <div className="flex flex-wrap gap-2">
                {CHANNELS.map((c) => {
                    const active = value === c.value;
                    return (
                        <button
                            key={c.value}
                            type="button"
                            onClick={() => onChange(active ? null : c.value)}
                            className={cx(
                                "rounded-full px-3 py-1 text-sm font-medium ring-1 transition duration-100 ease-linear ring-inset",
                                active ? "bg-brand-primary text-brand-secondary ring-brand" : "bg-primary text-secondary ring-primary hover:bg-secondary_hover",
                            )}
                        >
                            {c.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function DeadlinePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const activeQuick = QUICK_DEADLINES.find((q) => value === deadlineFromNow(q.days));
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-secondary">Deadline</span>
            <div className="flex flex-wrap items-center gap-2">
                {QUICK_DEADLINES.map((q) => {
                    const active = activeQuick?.days === q.days;
                    return (
                        <button
                            key={q.days}
                            type="button"
                            onClick={() => onChange(deadlineFromNow(q.days))}
                            className={cx(
                                "rounded-full px-3 py-1 text-sm font-medium ring-1 transition duration-100 ease-linear ring-inset",
                                active ? "bg-brand-primary text-brand-secondary ring-brand" : "bg-primary text-secondary ring-primary hover:bg-secondary_hover",
                            )}
                        >
                            {q.label}
                        </button>
                    );
                })}
                <ControlledDateInput variant="datetime" value={value || null} onChange={onChange} className="min-w-56" />
                {value && (
                    <Button color="link-gray" size="sm" onClick={() => onChange("")}>
                        Clear
                    </Button>
                )}
            </div>
        </div>
    );
}

function ComposeCard({ contacts, createAction }: { contacts: DraftContact[]; createAction: (formData: FormData) => Promise<void> }) {
    const [contactId, setContactId] = useState<string | null>(null);
    const [channel, setChannel] = useState<string | null>("TEXT");
    const [body, setBody] = useState("");
    const [dueAt, setDueAt] = useState("");
    const [saving, setSaving] = useState(false);

    async function save() {
        if (!body.trim()) {
            toast.error("Message body is required");
            return;
        }
        setSaving(true);
        try {
            const fd = new FormData();
            if (contactId) fd.set("contactId", contactId);
            if (channel) fd.set("channel", channel);
            fd.set("body", body);
            if (dueAt) fd.set("dueAt", dueAt);
            await createAction(fd);
            toast.success("Draft saved");
            setBody("");
            setDueAt("");
            setContactId(null);
            setChannel("TEXT");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card>
            <CardHeader title="Compose draft" />
            <CardBody className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <ContactSelect contacts={contacts} value={contactId} onChange={setContactId} />
                    <ChannelChips value={channel} onChange={setChannel} />
                </div>
                <TextareaInput name="body" label="Message" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What do you want to say?" />
                <DeadlinePicker value={dueAt} onChange={setDueAt} />
                <div className="flex justify-end">
                    <Button color="primary" iconLeading={<Send01 data-icon className="size-4" />} isLoading={saving} showTextWhileLoading onClick={save}>
                        Save draft
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}

function Group({
    title,
    items,
    actions,
    onEdit,
    muted,
}: {
    title: string;
    items: DraftItem[];
    actions: Actions;
    onEdit: (d: DraftItem) => void;
    muted?: boolean;
}) {
    if (items.length === 0) return null;
    return (
        <Card>
            <CardHeader title={`${title} (${items.length})`} />
            <CardBody>
                <ul className="flex flex-col divide-y divide-secondary">
                    {items.map((d) => (
                        <DraftRow key={d.id} draft={d} actions={actions} onEdit={onEdit} muted={muted} />
                    ))}
                </ul>
            </CardBody>
        </Card>
    );
}

function DraftRow({ draft, actions, onEdit, muted }: { draft: DraftItem; actions: Actions; onEdit: (d: DraftItem) => void; muted?: boolean }) {
    const [expanded, setExpanded] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const { copied, copy } = useClipboard();
    const cd = countdown(draft.dueAt);
    const long = draft.body.length > 140;
    const preview = !expanded && long ? draft.body.slice(0, 140) + "…" : draft.body;

    async function run(key: string, action: (fd: FormData) => Promise<void>, success: string) {
        setBusy(key);
        try {
            const fd = new FormData();
            fd.set("id", draft.id);
            await action(fd);
            toast.success(success);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        } finally {
            setBusy(null);
        }
    }

    return (
        <li className={cx("flex flex-col gap-3 py-4 first:pt-0 last:pb-0", muted && "opacity-70")}>
            <div className="flex items-start gap-3">
                {draft.contact ? (
                    <Avatar size="sm" src={draft.contact.avatarUrl ?? undefined} initials={initials(draft.contact.displayName)} alt={draft.contact.displayName} />
                ) : (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-tertiary">
                        <MessageTextSquare01 className="size-4" aria-hidden="true" />
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-primary">{draft.contact?.displayName ?? "No contact"}</span>
                        {draft.channel && <Badge size="sm" color="gray">{CHANNEL_LABEL[draft.channel] ?? draft.channel}</Badge>}
                        {draft.sentAt ? (
                            <Badge size="sm" color="success">Sent</Badge>
                        ) : cd ? (
                            <Badge size="sm" color={cd.overdue ? "error" : "warning"}>{cd.text}</Badge>
                        ) : null}
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-secondary">{preview}</p>
                    {long && (
                        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-medium text-brand-secondary hover:underline">
                            {expanded ? "Show less" : "Show more"}
                        </button>
                    )}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-11">
                <Button color="secondary" size="sm" iconLeading={copied ? <Check data-icon className="size-4" /> : <Copy01 data-icon className="size-4" />} onClick={() => copy(draft.body)}>
                    {copied ? "Copied" : "Copy"}
                </Button>
                {!draft.sentAt && (
                    <Button color="primary" size="sm" iconLeading={<Send01 data-icon className="size-4" />} isLoading={busy === "sent"} showTextWhileLoading onClick={() => run("sent", actions.markSentAction, "Marked sent")}>
                        Mark sent
                    </Button>
                )}
                <Button color="tertiary" size="sm" iconLeading={<Edit01 data-icon className="size-4" />} onClick={() => onEdit(draft)}>
                    Edit
                </Button>
                <Button color="tertiary" size="sm" iconLeading={<Archive data-icon className="size-4" />} isLoading={busy === "archive"} showTextWhileLoading onClick={() => run("archive", actions.archiveAction, "Archived")}>
                    Archive
                </Button>
                <Button color="tertiary-destructive" size="sm" iconLeading={<X data-icon className="size-4" />} isLoading={busy === "delete"} showTextWhileLoading onClick={() => run("delete", actions.deleteAction, "Deleted")}>
                    Delete
                </Button>
            </div>
        </li>
    );
}

function EditDialog({
    draft,
    contacts,
    updateAction,
    onClose,
}: {
    draft: DraftItem;
    contacts: DraftContact[];
    updateAction: (formData: FormData) => Promise<void>;
    onClose: () => void;
}) {
    const [contactId, setContactId] = useState<string | null>(draft.contactId);
    const [channel, setChannel] = useState<string | null>(draft.channel);
    const [body, setBody] = useState(draft.body);
    const [dueAt, setDueAt] = useState(draft.dueAt ? toLocalInput(new Date(draft.dueAt)) : "");

    async function onSubmit(fd: FormData) {
        fd.set("id", draft.id);
        if (contactId) fd.set("contactId", contactId);
        else fd.delete("contactId");
        if (channel) fd.set("channel", channel);
        else fd.delete("channel");
        fd.set("body", body);
        if (dueAt) fd.set("dueAt", dueAt);
        else fd.delete("dueAt");
        try {
            await updateAction(fd);
            toast.success("Draft updated");
            onClose();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to update");
        }
    }

    return (
        <ModalOverlay isDismissable isOpen onOpenChange={(o) => !o && onClose()}>
            <Modal className="max-w-lg">
                <Dialog aria-label="Edit draft">
                    <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                        <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                            <h2 className="text-md font-semibold text-primary">Edit draft</h2>
                            <Button color="tertiary" size="sm" iconLeading={X} onClick={onClose} aria-label="Close" />
                        </div>
                        <form action={onSubmit} className="flex flex-col gap-4 p-5">
                            <ContactSelect contacts={contacts} value={contactId} onChange={setContactId} />
                            <ChannelChips value={channel} onChange={setChannel} />
                            <TextareaInput name="body" label="Message" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
                            <DeadlinePicker value={dueAt} onChange={setDueAt} />
                            <div className="flex justify-end gap-2 pt-1">
                                <Button color="secondary" onClick={onClose}>
                                    Cancel
                                </Button>
                                <SubmitButton color="primary">Save</SubmitButton>
                            </div>
                        </form>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

function initials(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
