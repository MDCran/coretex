"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Download01, Eye, File02 } from "@untitledui/icons";
import type { JobDocumentKind } from "@prisma/client";
import { Badge, BadgeWithIcon } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Select, type SelectItemType } from "@/components/base/select/select";
import { FileUpload } from "@/components/application/file-upload/file-upload-base";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { DeleteButton } from "@/components/jobs/delete-button";
import { AddVersionDialog, EditDocumentDialog, EditVersionLabelDialog, RenameFileDialog } from "@/components/jobs/document-dialogs";
import { DocumentPreviewModal, type PreviewTarget } from "@/components/jobs/document-preview-modal";
import { DOCUMENT_KIND_LABELS } from "@/lib/jobs/enums";
import { fmtDate, fmtFileSize } from "@/lib/jobs/format";
import { addVersion, changeDocumentKind, deleteDocument, deleteVersion } from "@/lib/actions/jobs-documents";

const KIND_ITEMS: SelectItemType[] = (Object.keys(DOCUMENT_KIND_LABELS) as JobDocumentKind[]).map((k) => ({
    id: k,
    label: DOCUMENT_KIND_LABELS[k],
}));

function KindSelect({ docId, currentKind }: { docId: string; currentKind: JobDocumentKind }) {
    const [pending, start] = useTransition();
    return (
        <div className="w-36">
            <Select
                size="sm"
                aria-label="Document type"
                selectedKey={currentKind}
                isDisabled={pending}
                onSelectionChange={(key) =>
                    start(async () => {
                        try {
                            await changeDocumentKind(docId, key as JobDocumentKind);
                        } catch {
                            toast.error("Failed to update type");
                        }
                    })
                }
                items={KIND_ITEMS}
            >
                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
            </Select>
        </div>
    );
}

export interface DocumentVersionData {
    id: string;
    versionNumber: number;
    label: string | null;
    fileName: string;
    fileSize: number;
    mimeType: string;
    createdAt: string;
    previewUrl: string;
    downloadUrl: string;
    usedAsResumeCount: number;
    usedAsCoverLetterCount: number;
    /** Applications pinning this exact version (as resume or cover letter). */
    apps: { id: string; role: string; companyName: string }[];
}

export interface DocumentCardData {
    id: string;
    name: string;
    kind: JobDocumentKind;
    versions: DocumentVersionData[];
}

const UPLOAD_ACCEPT = ".pdf,.doc,.docx,.txt,.md,.rtf,.odt,.pages,.png,.jpg,.jpeg,.ppt,.pptx,.xls,.xlsx,.csv,.zip";

/** Signed size-vs-previous-version chip, e.g. "+12.4 KB" / "−3.1 KB". */
function SizeDelta({ current, previous }: { current: number; previous: number | undefined }) {
    if (previous === undefined) return null;
    const delta = current - previous;
    if (delta === 0) {
        return (
            <Badge color="gray" size="sm" type="modern">
                same size
            </Badge>
        );
    }
    return (
        <BadgeWithIcon iconLeading={delta > 0 ? ArrowUp : ArrowDown} color="gray" size="sm" type="modern">
            {delta > 0 ? "+" : "−"}
            {fmtFileSize(Math.abs(delta))}
        </BadgeWithIcon>
    );
}

/** Expandable list of the applications pinning a version. */
function UsedByList({ apps }: { apps: DocumentVersionData["apps"] }) {
    const [open, setOpen] = useState(false);
    if (apps.length === 0) return null;
    return (
        <div className="flex flex-col gap-1.5">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-fit items-center gap-1 text-xs font-medium text-brand-secondary transition duration-100 ease-linear hover:text-brand-secondary_hover"
            >
                {open ? <ChevronUp aria-hidden="true" className="size-3.5" /> : <ChevronDown aria-hidden="true" className="size-3.5" />}
                Used by {apps.length} application{apps.length === 1 ? "" : "s"}
            </button>
            {open && (
                <ul className="flex flex-col gap-0.5 border-l-2 border-secondary pl-3">
                    {apps.map((a) => (
                        <li key={a.id}>
                            <Link href={`/career/applications/${a.id}`} className="text-xs text-secondary transition duration-100 ease-linear hover:text-primary hover:underline">
                                {a.role} <span className="text-tertiary">· {a.companyName}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export function DocumentCard({ doc }: { doc: DocumentCardData }) {
    const [expanded, setExpanded] = useState(false);
    const [preview, setPreview] = useState<PreviewTarget | null>(null);
    const [uploading, startUpload] = useTransition();

    const latest = doc.versions[0];
    const nextVersion = (latest?.versionNumber ?? 0) + 1;

    function usageOf(v: DocumentVersionData) {
        if (doc.kind === "RESUME") return v.usedAsResumeCount;
        if (doc.kind === "COVER_LETTER") return v.usedAsCoverLetterCount;
        return 0;
    }

    /** Quick upload straight from the per-card drop zone (no label dialog). */
    function uploadDropped(files: FileList) {
        const file = files[0];
        if (!file) return;
        startUpload(async () => {
            try {
                const fd = new FormData();
                fd.append("file", file);
                await addVersion(doc.id, fd);
                toast.success(`v${nextVersion} uploaded`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Upload failed");
            }
        });
    }

    return (
        <Card>
            <CardHeader
                title={
                    <span className="flex flex-wrap items-center gap-2">
                        <File02 aria-hidden="true" className="size-4 text-fg-quaternary" />
                        {doc.name}
                        <KindSelect docId={doc.id} currentKind={doc.kind} />
                        <span className="text-xs font-normal text-tertiary">
                            {doc.versions.length} version{doc.versions.length === 1 ? "" : "s"}
                        </span>
                    </span>
                }
                action={
                    <div className="flex items-center gap-1">
                        <EditDocumentDialog id={doc.id} name={doc.name} kind={doc.kind} />
                        <DeleteButton
                            action={deleteDocument}
                            id={doc.id}
                            iconOnly
                            title="Delete document?"
                            description="This deletes the document and all of its versions. This cannot be undone."
                        />
                    </div>
                }
            />
            <CardBody className="flex flex-col gap-4">
                {/* Latest summary row */}
                {latest ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <Badge color="brand" size="sm">
                            v{latest.versionNumber}
                        </Badge>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-primary">{latest.label ?? latest.fileName}</div>
                            <div className="truncate text-xs text-tertiary">
                                Latest · {latest.fileName} · {fmtFileSize(latest.fileSize)} · {fmtDate(latest.createdAt)}
                            </div>
                        </div>
                        <SizeDelta current={latest.fileSize} previous={doc.versions[1]?.fileSize} />
                        <Button
                            color="secondary"
                            size="sm"
                            iconLeading={<Eye data-icon className="size-4" />}
                            onClick={() =>
                                setPreview({
                                    title: `${doc.name} · v${latest.versionNumber}`,
                                    fileName: latest.fileName,
                                    mimeType: latest.mimeType,
                                    previewUrl: latest.previewUrl,
                                    downloadUrl: latest.downloadUrl,
                                })
                            }
                        >
                            Preview
                        </Button>
                        <Button
                            href={latest.downloadUrl}
                            color="tertiary"
                            size="sm"
                            iconLeading={<Download01 data-icon className="size-4" />}
                            aria-label="Download latest"
                        />
                    </div>
                ) : (
                    <p className="text-sm text-tertiary">No versions uploaded yet.</p>
                )}

                {latest && <UsedByList apps={latest.apps} />}

                {/* Drop a file anywhere on the zone to instantly cut the next version. */}
                <FileUpload.DropZone
                    accept={UPLOAD_ACCEPT}
                    allowsMultiple={false}
                    isDisabled={uploading}
                    hint={uploading ? `Uploading v${nextVersion}…` : `Drop a file to upload v${nextVersion} · PDF, DOC, DOCX, TXT`}
                    onDropFiles={uploadDropped}
                    onDropUnacceptedFiles={() => toast.error("That file type isn't supported")}
                    className="px-4 py-3"
                />

                <div className="flex flex-wrap items-center gap-2">
                    <AddVersionDialog documentId={doc.id} nextVersion={nextVersion} />
                    {doc.versions.length > 0 && (
                        <Button
                            color="link-color"
                            size="sm"
                            iconTrailing={expanded ? <ChevronUp data-icon className="size-4" /> : <ChevronDown data-icon className="size-4" />}
                            onClick={() => setExpanded((e) => !e)}
                        >
                            {expanded ? "Hide" : "Show"} version history
                        </Button>
                    )}
                </div>

                {expanded && doc.versions.length > 0 && (
                    <ul className="flex flex-col divide-y divide-secondary rounded-lg ring-1 ring-secondary ring-inset">
                        {doc.versions.map((v, i) => {
                            const used = usageOf(v);
                            const previous = doc.versions[i + 1];
                            const deleteDescription =
                                used > 0
                                    ? `This version is pinned by ${used} application${used === 1 ? "" : "s"}. Deleting it removes that reference. This cannot be undone.`
                                    : "This permanently deletes the version. This cannot be undone.";
                            return (
                                <li key={v.id} className="flex flex-col gap-2 px-3 py-3">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <Badge color={v.versionNumber === latest?.versionNumber ? "brand" : "gray"} size="sm">
                                            v{v.versionNumber}
                                        </Badge>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium text-primary">{v.label ?? v.fileName}</div>
                                            <div className="truncate text-xs text-tertiary">
                                                {v.fileName} · {fmtFileSize(v.fileSize)} · uploaded {fmtDate(v.createdAt)}
                                            </div>
                                        </div>
                                        <SizeDelta current={v.fileSize} previous={previous?.fileSize} />
                                        {used > 0 && (
                                            <Badge color="warning" size="sm" type="pill-color">
                                                In use · {used}
                                            </Badge>
                                        )}
                                    </div>
                                    <UsedByList apps={v.apps} />
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <Button
                                            color="secondary"
                                            size="sm"
                                            iconLeading={<Eye data-icon className="size-4" />}
                                            onClick={() =>
                                                setPreview({
                                                    title: `${doc.name} · v${v.versionNumber}`,
                                                    fileName: v.fileName,
                                                    mimeType: v.mimeType,
                                                    previewUrl: v.previewUrl,
                                                    downloadUrl: v.downloadUrl,
                                                })
                                            }
                                        >
                                            Preview
                                        </Button>
                                        <Button
                                            href={v.downloadUrl}
                                            color="secondary"
                                            size="sm"
                                            iconLeading={<Download01 data-icon className="size-4" />}
                                        >
                                            Download
                                        </Button>
                                        <EditVersionLabelDialog id={v.id} versionNumber={v.versionNumber} label={v.label} />
                                        <RenameFileDialog id={v.id} versionNumber={v.versionNumber} fileName={v.fileName} />
                                        <DeleteButton action={deleteVersion} id={v.id} label="Delete" title="Delete version?" description={deleteDescription} />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardBody>

            <DocumentPreviewModal target={preview} onClose={() => setPreview(null)} />
        </Card>
    );
}
