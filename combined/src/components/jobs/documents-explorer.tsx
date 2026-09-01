"use client";

import { useMemo, useState } from "react";
import { File02, FileX03, HardDrive, LayersTwo01, SearchLg } from "@untitledui/icons";
import type { JobDocumentKind } from "@prisma/client";
import { Input } from "@/components/base/input/input";
import { Select, type SelectItemType } from "@/components/base/select/select";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Card, CardBody } from "@/components/jobs/card";
import { DocumentCard, type DocumentCardData } from "@/components/jobs/document-card";
import { NewDocumentDialog } from "@/components/jobs/document-dialogs";
import { fmtFileSize } from "@/lib/jobs/format";

type SortKey = "recent" | "name" | "versions";

const SORT_ITEMS: SelectItemType[] = [
    { id: "recent", label: "Recently updated" },
    { id: "name", label: "Name A–Z" },
    { id: "versions", label: "Most versions" },
];

const GROUPS: { kind: JobDocumentKind; label: string; newLabel: string }[] = [
    { kind: "RESUME", label: "Resumes", newLabel: "New resume" },
    { kind: "COVER_LETTER", label: "Cover letters", newLabel: "New cover letter" },
    { kind: "CERTIFICATION", label: "Certifications", newLabel: "New certification" },
    { kind: "EDUCATION", label: "Education", newLabel: "New education document" },
    { kind: "CAREER_OTHER", label: "Other", newLabel: "New document" },
];

function latestAt(doc: DocumentCardData): number {
    return doc.versions.length ? new Date(doc.versions[0].createdAt).getTime() : 0;
}

export function DocumentsExplorer({ docs, allowedKinds, grouped = true }: { docs: DocumentCardData[]; allowedKinds?: JobDocumentKind[]; grouped?: boolean }) {
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<SortKey>("recent");
    const [kindFilter, setKindFilter] = useState<string>("all");

    const activeGroups = allowedKinds ? GROUPS.filter((g) => allowedKinds.includes(g.kind)) : GROUPS;
    const kindFilterItems: SelectItemType[] = [
        { id: "all", label: "All categories" },
        ...activeGroups.map((g) => ({ id: g.kind, label: g.label })),
    ];

    const totalVersions = docs.reduce((sum, d) => sum + d.versions.length, 0);
    const totalBytes = docs.reduce((sum, d) => sum + d.versions.reduce((s, v) => s + v.fileSize, 0), 0);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        const filtered = docs.filter((d) => {
            const matchesKind = kindFilter === "all" || d.kind === kindFilter;
            const matchesQuery =
                !q ||
                d.name.toLowerCase().includes(q) ||
                d.versions.some((v) => v.fileName.toLowerCase().includes(q) || (v.label ?? "").toLowerCase().includes(q));
            return matchesKind && matchesQuery;
        });
        return [...filtered].sort((a, b) => {
            if (sort === "name") return a.name.localeCompare(b.name);
            if (sort === "versions") return b.versions.length - a.versions.length || a.name.localeCompare(b.name);
            return latestAt(b) - latestAt(a) || a.name.localeCompare(b.name);
        });
    }, [docs, query, sort, kindFilter]);

    const stats = [
        { label: "Documents", value: String(docs.length), icon: File02 },
        { label: "Versions", value: String(totalVersions), icon: LayersTwo01 },
        { label: "Storage used", value: fmtFileSize(totalBytes), icon: HardDrive },
    ];

    if (docs.length === 0) {
        return (
            <Card>
                <CardBody className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                    <FeaturedIcon icon={File02} color="brand" theme="light" size="lg" />
                    <p className="text-sm font-semibold text-primary">Keep every career document in one place</p>
                    <p className="max-w-sm text-sm text-tertiary">
                        Upload resumes, cover letters, certifications, and education files with version history and downloads.
                    </p>
                    <div className="mt-1">
                        <NewDocumentDialog />
                    </div>
                </CardBody>
            </Card>
        );
    }

    const isFiltering = query.trim().length > 0 || kindFilter !== "all";

    return (
        <div className="flex flex-col gap-6">
            {/* Stats row */}
            <div className="grid gap-3 sm:grid-cols-3">
                {stats.map((s) => (
                    <div key={s.label} className="flex items-center gap-3 rounded-xl bg-primary px-4 py-3 ring-1 ring-secondary ring-inset">
                        <s.icon aria-hidden="true" className="size-5 shrink-0 text-fg-quaternary" />
                        <div className="min-w-0">
                            <div className="truncate text-lg font-semibold tabular-nums text-primary">{s.value}</div>
                            <div className="truncate text-xs text-tertiary">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search + filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                    <Input
                        size="sm"
                        icon={SearchLg}
                        aria-label="Search documents"
                        placeholder="Search by name, file or label…"
                        value={query}
                        onChange={(v) => setQuery(v)}
                    />
                </div>
                <div className="sm:w-48">
                    <Select
                        aria-label="Filter by category"
                        size="sm"
                        items={kindFilterItems}
                        selectedKey={kindFilter}
                        onSelectionChange={(key) => setKindFilter((key as string) ?? "all")}
                    >
                        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                    </Select>
                </div>
                <div className="sm:w-48">
                    <Select
                        aria-label="Sort documents"
                        size="sm"
                        items={SORT_ITEMS}
                        selectedKey={sort}
                        onSelectionChange={(key) => setSort((key as SortKey) ?? "recent")}
                    >
                        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                    </Select>
                </div>
            </div>

            {visible.length === 0 ? (
                <Card>
                    <CardBody className="flex flex-col items-center gap-2 py-12 text-center">
                        <FeaturedIcon icon={FileX03} color="gray" theme="modern" size="md" />
                        <p className="text-sm font-medium text-secondary">
                            {isFiltering ? "No documents match your filters" : "No documents yet"}
                        </p>
                        <p className="text-xs text-tertiary">
                            {isFiltering ? "Try adjusting the search or category filter." : "Add your first career document above."}
                        </p>
                    </CardBody>
                </Card>
            ) : grouped ? (
                <div className="flex flex-col gap-10">
                    {activeGroups.map((group) => {
                        const groupDocs = visible.filter((d) => d.kind === group.kind);
                        if (groupDocs.length === 0) return null;
                        return (
                            <section key={group.kind}>
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <h2 className="text-sm font-semibold tracking-wide text-tertiary uppercase">
                                        {group.label} <span className="ml-0.5 font-normal">({groupDocs.length})</span>
                                    </h2>
                                    <NewDocumentDialog kind={group.kind} label={group.newLabel} color="secondary" size="sm" />
                                </div>
                                <div className="flex flex-col gap-4">
                                    {groupDocs.map((doc) => (
                                        <DocumentCard key={doc.id} doc={doc} />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {visible.map((doc) => (
                        <DocumentCard key={doc.id} doc={doc} />
                    ))}
                </div>
            )}
        </div>
    );
}
