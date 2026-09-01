// @ts-nocheck
import { Badge } from "@/components/base/badges/badges";
import FormDateInput from "@/components/base/input/form-date-input";
import { formatDateShort } from "@/lib/dates";
import { Plus, BookOpen01, Edit01, Trash02 } from "@untitledui/icons";
import { formatDate } from "../../personal/personal-ui";
import { useState, useMemo } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";
import { HealthEmptyState } from "../_components/empty-state";
import { FormModal } from "../_components/form-modal";
import { SectionHeader, Card, Field, NativeInput, NativeTextarea } from "../_components/health-ui";
import { TrendPoint, TrendChart } from "../_components/trend-chart";



export interface RealmRatingRow {
    realm: string;
    rating: number;
}
export interface JournalRow {
    id: string;
    date: string;
    reflection: string | null;
    gratitude: string | null;
    overallRating: number | null;
    realmRatings: RealmRatingRow[];
}

const REALMS: { key: string; label: string }[] = [
    { key: "physical_health", label: "Physical health" },
    { key: "mental_health", label: "Mental health" },
    { key: "relationships", label: "Relationships" },
    { key: "work", label: "Work" },
    { key: "finances", label: "Finances" },
    { key: "growth", label: "Growth" },
];

export function JournalClient({ entries }: { entries: JournalRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<JournalRow | null>(null);

    const trend: TrendPoint[] = useMemo(
        () =>
            entries
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((e) => ({ label: formatDateShort(e.date), overall: e.overallRating })),
        [entries],
    );

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(row: JournalRow) {
        setEditing(row);
        setOpen(true);
    }
    function realmValue(row: JournalRow | null, key: string) {
        return row?.realmRatings.find((r) => r.realm === key)?.rating ?? "";
    }

    async function onSubmit(fd: FormData) {
        try {
            await upsertJournalEntry(fd);
            toast.success("Journal saved");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteJournalEntry(fd);
            toast.success("Deleted");
        } catch {
            toast.error("Failed to delete");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Journal" description="Daily reflection, gratitude and life-realm ratings." action={<Button size="md" iconLeading={Plus} onClick={openCreate}>New entry</Button>} />

            <Card>
                <h3 className="mb-4 text-md font-semibold text-primary">Overall rating trend</h3>
                <TrendChart data={trend} series={[{ key: "overall", name: "Overall (1-10)" }]} type="area" fitDomain emptyLabel="No entries yet" />
            </Card>

            <div className="flex flex-col gap-3">
                {entries.length === 0 && (
                    <Card className="p-0">
                        <HealthEmptyState
                            icon={BookOpen01}
                            title="Start your first reflection"
                            description="Capture how your day went, what you're grateful for, and rate the realms of your life. Small notes, big clarity over time."
                            actionLabel="New entry"
                            onAction={openCreate}
                        />
                    </Card>
                )}
                {entries.map((e) => (
                    <Card key={e.id}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <BookOpen01 className="size-5 text-fg-quaternary" />
                                <div>
                                    <p className="text-sm font-semibold text-primary">{formatDate(e.date)}</p>
                                    {e.overallRating != null && <p className="text-xs text-tertiary">Overall {e.overallRating}/10</p>}
                                </div>
                            </div>
                            <div className="flex gap-1">
                                <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(e)} aria-label="Edit" />
                                <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(e.id)} aria-label="Delete" />
                            </div>
                        </div>
                        {e.reflection && <p className="mt-3 text-sm text-secondary whitespace-pre-wrap">{e.reflection}</p>}
                        {e.gratitude && (
                            <p className="mt-2 text-sm text-tertiary">
                                <span className="font-medium text-secondary">Grateful for: </span>
                                {e.gratitude}
                            </p>
                        )}
                        {e.realmRatings.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {e.realmRatings.map((r) => (
                                    <Badge key={r.realm} color="gray" size="sm">
                                        {REALMS.find((x) => x.key === r.realm)?.label ?? r.realm}: {r.rating}
                                    </Badge>
                                ))}
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit entry" : "New journal entry"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <div className="grid grid-cols-2 gap-4">
                        <FormDateInput name="date" label="Date" isRequired defaultValue={editing?.date ?? new Date().toISOString().slice(0, 10)} />
                        <Field label="Overall (1-10)" htmlFor="overallRating">
                            <NativeInput id="overallRating" name="overallRating" type="number" min={1} max={10} defaultValue={editing?.overallRating ?? ""} />
                        </Field>
                    </div>
                    <Field label="Reflection" htmlFor="reflection">
                        <NativeTextarea id="reflection" name="reflection" defaultValue={editing?.reflection ?? ""} placeholder="How was your day?" />
                    </Field>
                    <Field label="Gratitude" htmlFor="gratitude">
                        <NativeTextarea id="gratitude" name="gratitude" defaultValue={editing?.gratitude ?? ""} placeholder="What are you grateful for?" />
                    </Field>
                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium text-secondary">Realm ratings (1-10)</span>
                        <div className="grid grid-cols-2 gap-3">
                            {REALMS.map((r) => (
                                <Field key={r.key} label={r.label} htmlFor={`realm_${r.key}`}>
                                    <NativeInput id={`realm_${r.key}`} name={`realm_${r.key}`} type="number" min={1} max={10} defaultValue={realmValue(editing, r.key)} />
                                </Field>
                            ))}
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Save</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
