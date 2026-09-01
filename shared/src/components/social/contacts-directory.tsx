// @ts-nocheck
import { useMemo, useState } from "react";

import type { Key } from "react-aria-components";
import { SearchLg, Star01, Users01, Heart, Shield01, Clock, SwitchVertical01 } from "@untitledui/icons";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Card, CardBody, EmptyState } from "@/components/social/ui";
import { LocalTime } from "@/components/social/local-time";
import { TagsInline, TAG_SWATCH, type TagRow } from "@/components/social/tags-inline";
import type { BadgeColors } from "@/components/base/badges/badge-types";
import { cx } from "@/utils/cx";
import { RELATIONSHIP_LABELS, RELATIONSHIP_COLORS, labelOf } from "@/lib/social/enums";
import { initialsOf, fmtRelative, connectionHealth, type ConnectionHealth } from "@/lib/social/format";

export type DirectoryContact = {
    id: string;
    displayName: string;
    relationshipType: string | null;
    occupation: string | null;
    closenessScore: number | null;
    trustScore: number | null;
    innerCircle: boolean;
    active: boolean;
    avatarUrl: string | null;
    timezone: string | null;
    lastContactAt: string | null;
    stayInTouch: boolean;
    stayInTouchDays: number | null;
    energyTags: string[];
    tags: { id: string; name: string; color: string | null }[];
    /** Recent interaction/communication timestamps for the live health monitor. */
    activityDates: string[];
};

type SortKey = "name" | "closeness" | "recent" | "health";

const SORTS: { value: SortKey; label: string }[] = [
    { value: "name", label: "Name (A–Z)" },
    { value: "closeness", label: "Closeness" },
    { value: "recent", label: "Recently contacted" },
    { value: "health", label: "Connection health" },
];

/** Tiny dual mini-meter (closeness + trust) for the card. */
function MiniMeters({ closeness, trust }: { closeness: number | null; trust: number | null }) {
    if (closeness == null && trust == null) return null;
    const bar = (value: number | null, color: string) => (
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-quaternary">
            <div className={cx("h-full rounded-full", color)} style={{ width: `${(Math.max(0, Math.min(10, value ?? 0)) / 10) * 100}%` }} />
        </div>
    );
    return (
        <div className="flex flex-col gap-1.5">
            {closeness != null && (
                <div className="flex items-center gap-1.5" title={`Closeness ${closeness}/10`}>
                    <Heart className="size-3 shrink-0 text-fg-quaternary" aria-hidden="true" />
                    {bar(closeness, "bg-brand-solid")}
                </div>
            )}
            {trust != null && (
                <div className="flex items-center gap-1.5" title={`Trust ${trust}/10`}>
                    <Shield01 className="size-3 shrink-0 text-fg-quaternary" aria-hidden="true" />
                    {bar(trust, "bg-success-solid")}
                </div>
            )}
        </div>
    );
}

function ContactCard({ c }: { c: DirectoryContact }) {
    const health: ConnectionHealth = connectionHealth(c.activityDates, c.lastContactAt ? new Date(c.lastContactAt) : null, c.stayInTouchDays);
    const lastLabel = c.lastContactAt ? `${fmtRelative(c.lastContactAt)}` : "No contact yet";
    return (
        <a href="#">
            <Card className={cx("flex h-full flex-col transition duration-100 ease-linear hover:ring-2 hover:ring-brand", !c.active && "opacity-60")}>
                <CardBody className="flex flex-1 flex-col gap-3.5">
                    <div className="flex items-start gap-3">
                        <Avatar size="md" src={c.avatarUrl ?? undefined} initials={initialsOf(c.displayName)} alt={c.displayName} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <span className="truncate font-semibold text-primary">{c.displayName}</span>
                                {c.innerCircle && <Star01 className="size-3.5 shrink-0 text-fg-warning-primary" aria-hidden="true" />}
                            </div>
                            <div className="truncate text-sm text-tertiary">{c.occupation || labelOf(RELATIONSHIP_LABELS, c.relationshipType)}</div>
                            {c.timezone && <LocalTime timezone={c.timezone} className="mt-0.5" />}
                        </div>
                        <Badge size="sm" color={health.color as BadgeColors}>
                            {health.label}
                        </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                        {c.relationshipType && (
                            <Badge size="sm" color={(RELATIONSHIP_COLORS[c.relationshipType] as BadgeColors) ?? "gray"}>
                                {labelOf(RELATIONSHIP_LABELS, c.relationshipType)}
                            </Badge>
                        )}
                        {c.tags.slice(0, 3).map((t) => (
                            <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary">
                                <span className={cx("size-1.5 rounded-full", TAG_SWATCH[t.color ?? "gray"] ?? "bg-fg-quaternary")} />
                                {t.name}
                            </span>
                        ))}
                    </div>

                    <MiniMeters closeness={c.closenessScore} trust={c.trustScore} />

                    {c.energyTags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {c.energyTags.slice(0, 4).map((t) => (
                                <span key={t} className="rounded-full bg-brand-secondary px-2 py-0.5 text-xs font-medium text-brand-secondary">
                                    {t}
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="mt-auto flex items-center gap-1.5 border-t border-secondary pt-3 text-xs text-tertiary">
                        <Clock className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">Last contacted {lastLabel}</span>
                    </div>
                </CardBody>
            </Card>
        </a>
    );
}

export function ContactsDirectory({
    contacts,
    tags,
    createTagAction,
    updateTagAction,
    deleteTagAction,
}: {
    contacts: DirectoryContact[];
    tags: TagRow[];
    createTagAction: (formData: FormData) => Promise<void>;
    updateTagAction: (formData: FormData) => Promise<void>;
    deleteTagAction: (formData: FormData) => Promise<void>;
}) {
    const [query, setQuery] = useState("");
    const [relationship, setRelationship] = useState("");
    const [tagId, setTagId] = useState("");
    const [innerOnly, setInnerOnly] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [sort, setSort] = useState<SortKey>("name");

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = contacts.filter((c) => {
            if (!showArchived && !c.active) return false;
            if (innerOnly && !c.innerCircle) return false;
            if (relationship && c.relationshipType !== relationship) return false;
            if (tagId && !c.tags.some((t) => t.id === tagId)) return false;
            if (q && !c.displayName.toLowerCase().includes(q) && !(c.occupation ?? "").toLowerCase().includes(q)) return false;
            return true;
        });
        const ms = (d: string | null) => (d ? new Date(d).getTime() : 0);
        list.sort((a, b) => {
            switch (sort) {
                case "closeness":
                    return (b.closenessScore ?? -1) - (a.closenessScore ?? -1) || a.displayName.localeCompare(b.displayName);
                case "recent":
                    return ms(b.lastContactAt) - ms(a.lastContactAt) || a.displayName.localeCompare(b.displayName);
                case "health": {
                    const ha = connectionHealth(a.activityDates, a.lastContactAt ? new Date(a.lastContactAt) : null, a.stayInTouchDays).score;
                    const hb = connectionHealth(b.activityDates, b.lastContactAt ? new Date(b.lastContactAt) : null, b.stayInTouchDays).score;
                    return hb - ha || a.displayName.localeCompare(b.displayName);
                }
                default:
                    return a.displayName.localeCompare(b.displayName);
            }
        });
        return list;
    }, [contacts, query, relationship, tagId, innerOnly, showArchived, sort]);

    // Relationship filter chips, derived from what's actually present (no cut-off rail).
    const presentRelationships = useMemo(() => {
        const set = new Set<string>();
        contacts.forEach((c) => c.relationshipType && set.add(c.relationshipType));
        return Object.keys(RELATIONSHIP_LABELS).filter((k) => set.has(k));
    }, [contacts]);

    return (
        <div className="flex flex-col gap-5">
            {/* Filter bar: search + sort + tools, then a wrapping chip row that never clips. */}
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex-1">
                        <Input aria-label="Search contacts" icon={SearchLg} value={query} onChange={setQuery} placeholder="Search name or occupation…" />
                    </div>
                    <div className="flex items-center gap-2">
                        <Select.ComboBox
                            aria-label="Sort contacts"
                            icon={SwitchVertical01}
                            shortcut={false}
                            size="sm"
                            placeholder="Sort"
                            selectedKey={sort}
                            items={SORTS.map((s) => ({ id: s.value, label: s.label }))}
                            onSelectionChange={(key: Key | null) => {
                                if (key) setSort(key as SortKey);
                            }}
                            popoverClassName="min-w-52"
                            className="w-48 shrink-0"
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select.ComboBox>
                        <TagsInline tags={tags} createAction={createTagAction} updateAction={updateTagAction} deleteAction={deleteTagAction} />
                    </div>
                </div>

                {/* Relationship chips — wrap freely, full width, scroll-free. */}
                <div className="flex flex-wrap items-center gap-1.5">
                    <FilterChip active={relationship === ""} onClick={() => setRelationship("")}>
                        All relationships
                    </FilterChip>
                    {presentRelationships.map((k) => (
                        <FilterChip key={k} active={relationship === k} onClick={() => setRelationship(relationship === k ? "" : k)}>
                            {RELATIONSHIP_LABELS[k]}
                        </FilterChip>
                    ))}
                    <span className="mx-1 hidden h-5 w-px bg-border-secondary sm:inline-block" />
                    <FilterChip active={innerOnly} onClick={() => setInnerOnly((v) => !v)} icon={<Star01 className="size-3.5" aria-hidden="true" />}>
                        Inner circle
                    </FilterChip>
                    <FilterChip active={showArchived} onClick={() => setShowArchived((v) => !v)}>
                        Show archived
                    </FilterChip>
                </div>

                {tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-tertiary">Tags:</span>
                        <FilterChip active={tagId === ""} onClick={() => setTagId("")}>
                            All
                        </FilterChip>
                        {tags.map((t) => (
                            <FilterChip key={t.id} active={tagId === t.id} onClick={() => setTagId(tagId === t.id ? "" : t.id)} icon={<span className={cx("size-2 rounded-full", TAG_SWATCH[t.color ?? "gray"] ?? "bg-fg-quaternary")} />}>
                                {t.name}
                            </FilterChip>
                        ))}
                    </div>
                )}
            </div>

            {filtered.length === 0 ? (
                <Card>
                    {contacts.length === 0 ? (
                        <EmptyState
                            icon={Users01}
                            title="No contacts yet"
                            description="This is where your relationships live. Add the people you care about to track closeness, remember the details, and stay in touch."
                            action={{ label: "Add your first contact", href: "/social/contacts/new" }}
                        />
                    ) : (
                        <EmptyState
                            icon={SearchLg}
                            title="No matches"
                            description="No contacts match your search or filters. Try a different term or clear a filter to see everyone."
                        />
                    )}
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((c) => (
                        <ContactCard key={c.id} c={c} />
                    ))}
                </div>
            )}
        </div>
    );
}

function FilterChip({ active, onClick, children, icon }: { active: boolean; onClick: () => void; children: React.ReactNode; icon?: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition duration-100 ease-linear ring-inset",
                active ? "bg-brand-primary text-brand-secondary ring-brand" : "bg-primary text-secondary ring-secondary hover:bg-secondary_hover",
            )}
        >
            {icon}
            {children}
        </button>
    );
}
