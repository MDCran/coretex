// @ts-nocheck
"use client";

// Coretex Relay — Documents tab. Two cards over one project: the source-code
// index (set repo path → index → live status) and a full reference-documents
// manager (upload with title/description, see uploaded/modified dates, edit,
// delete, and preview). Both code and docs feed the same RAG store and are
// searched together by the Project Assistant (Chat tab).

import { useState } from "react";
import type { Project, ProjectDocMeta, UploadedDoc } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { Toggle } from "@/components/base/toggle/toggle";
import { Database01, FileCode02, FolderCode, RefreshCcw01, Edit01, Trash01, Eye, FileSearch02, Clock, Folder, GitBranch01 } from "@untitledui/icons";
import type { CoretexActions, CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { FileDrop, type UploadResult } from "../ui/file-drop";
import { FolderPicker } from "../files/folder-picker";

const CARD_STYLE = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;
const FIELD_STYLE = { background: "var(--surface-2)", border: "1px solid var(--c-border)" } as const;

const ACCEPT = ".txt,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.rb,.php,.yml,.yaml,.html,.css,.sql,.sh,.env,.xml,.toml";

const fmtKB = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const fmtDate = (ms?: number): string => (ms ? new Date(ms).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export const DocumentsTab = ({
    project,
    state,
    actions,
    onNavigate,
}: {
    project: Project;
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (t: NavTarget) => void;
}) => {
    const [path, setPath] = useState<string>(project.sourcePath ?? "");
    const [picking, setPicking] = useState(false);
    // The freshly-uploaded file awaiting a title/description before being attached.
    const [pending, setPending] = useState<UploadResult | null>(null);
    // The existing document being edited (title/description).
    const [editing, setEditing] = useState<ProjectDocMeta | null>(null);
    // The document open in the preview pane.
    const [preview, setPreview] = useState<ProjectDocMeta | null>(null);

    const index = state.codeIndex[project.id];
    const status = index?.status;
    const filesScanned = index?.filesScanned ?? 0;
    const chunks = index?.chunks ?? 0;
    const docChunks = index?.docChunks ?? 0;
    const hasSource = Boolean(project.sourcePath);
    const trimmed = path.trim();

    const docs = project.documents ?? [];

    const attach = (title: string, description: string): void => {
        if (!pending) return;
        const doc: UploadedDoc = {
            name: pending.name,
            mime: pending.mime,
            content: pending.dataUrl,
            title: title.trim() || pending.name,
            ...(description.trim() ? { description: description.trim() } : {}),
        };
        actions.addProjectDocuments(project.id, [doc]);
        setPending(null);
    };

    return (
        <div className="flex flex-col gap-5">
            {/* Card 1 — Source code */}
            <section className="rounded-xl p-5" style={CARD_STYLE}>
                <div className="flex items-center gap-2">
                    <FolderCode className="size-5 text-tertiary" />
                    <h2 className="text-sm font-semibold text-primary">Source code</h2>
                </div>

                <p className="mt-1 text-xs text-tertiary">
                    Point the assistant at this project&apos;s root folder for indexing. Nested git repos (and GitHub remotes) are managed under{" "}
                    <span className="font-medium text-secondary">Source Control</span> — file changes, line adds/removes, who edited what (agents), commits, messages, and push live there. Use relative paths like{" "}
                    <code className="text-[10px]">.</code> or <code className="text-[10px]">apps/web</code> under this root.
                </p>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <Input label="Project folder path" placeholder="/path/to/project" value={path} onChange={(value: string) => setPath(value)} />
                    </div>
                    <Button size="md" color="secondary" iconLeading={Folder} onClick={() => setPicking(true)}>
                        Browse
                    </Button>
                    <Button size="md" color="primary" iconLeading={Database01} isDisabled={trimmed.length === 0} onClick={() => actions.setProjectSource(project.id, trimmed)}>
                        Index code
                    </Button>
                    {hasSource && (
                        <Button size="md" color="secondary" iconLeading={RefreshCcw01} onClick={() => actions.reindexCode(project.id, true)}>
                            Reindex
                        </Button>
                    )}
                    {onNavigate && (
                        <Button
                            size="md"
                            color="tertiary"
                            iconLeading={GitBranch01}
                            onClick={() => onNavigate({ kind: "project", id: project.id, tab: "git" })}
                        >
                            Source Control
                            {(project.repos?.length ?? 0) > 0 ? ` (${project.repos!.length})` : ""}
                        </Button>
                    )}
                </div>

                {(project.repos?.length ?? 0) > 0 && (
                    <div className="mt-4 overflow-hidden rounded-xl" style={FIELD_STYLE}>
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid var(--c-border)" }}>
                            <div>
                                <p className="text-xs font-semibold text-secondary">Repository file sources</p>
                                <p className="mt-0.5 text-[11px] text-quaternary">Choose any number of local checkouts for project search, citations, and AI context.</p>
                            </div>
                            <Badge type="pill-color" size="sm" color="gray">
                                {project.repos!.filter((repo) => repo.path.trim() && repo.includeInIndex !== false).length} selected
                            </Badge>
                        </div>
                        <ul>
                            {project.repos!.map((repo) => {
                                const hasCheckout = repo.path.trim().length > 0;
                                return (
                                    <li key={repo.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" style={{ borderTop: "1px solid color-mix(in srgb, var(--c-border) 65%, transparent)" }}>
                                        <GitBranch01 className="size-4 shrink-0 text-tertiary" />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <p className="truncate text-xs font-medium text-secondary">{repo.name}</p>
                                                {repo.isPrimary && <Badge type="pill-color" size="sm" color="brand">Primary</Badge>}
                                                {!hasCheckout && <Badge type="pill-color" size="sm" color="gray">Remote only</Badge>}
                                            </div>
                                            <p className="mt-0.5 truncate font-mono text-[10px] text-quaternary">{repo.path || `${repo.github?.owner ?? "GitHub"}/${repo.github?.repo ?? "repository"} · clone required`}</p>
                                        </div>
                                        <label className="flex shrink-0 items-center gap-2 text-[11px] text-tertiary" title={!hasCheckout ? "Clone this repository before indexing its files." : undefined}>
                                            <Toggle
                                                size="sm"
                                                isSelected={hasCheckout && repo.includeInIndex !== false}
                                                isDisabled={!hasCheckout}
                                                onChange={(selected) => actions.setProjectRepos(
                                                    project.id,
                                                    project.repos!.map((current) => current.id === repo.id ? { ...current, includeInIndex: selected } : current),
                                                )}
                                            />
                                            Include files
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}

                {/* Version-control snapshot: dirty counts + recent agent editors → Source Control */}
                {hasSource && (() => {
                    const root = (project.sourcePath ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                    const repos = project.repos ?? [];
                    let dirty = 0;
                    let adds = 0;
                    let dels = 0;
                    for (const r of repos) {
                        const rel = (r.path || ".").trim();
                        const abs =
                            !rel || rel === "."
                                ? project.sourcePath ?? ""
                                : /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("/")
                                  ? rel
                                  : `${(project.sourcePath ?? "").replace(/[\\/]+$/, "")}/${rel.replace(/^[\\/]+/, "")}`;
                        const key = abs.replace(/\\/g, "/");
                        // Cache keys may use either slash style — try both.
                        const sc = state.sourceControl[abs] ?? state.sourceControl[key];
                        const s = sc?.summary;
                        if (!s?.isRepo) continue;
                        dirty += (s.staged ?? 0) + (s.unstaged ?? 0) + (s.untracked ?? 0);
                        adds += s.additions ?? 0;
                        dels += s.deletions ?? 0;
                    }
                    const editors = state.agentFileChanges
                        .filter((c) => {
                            if (c.projectId === project.id) return true;
                            if (!root) return false;
                            const p = c.path.replace(/\\/g, "/").toLowerCase();
                            return p === root || p.startsWith(root + "/");
                        })
                        .slice(0, 5);
                    if (repos.length === 0 && editors.length === 0) return null;
                    return (
                        <div className="mt-4 rounded-lg px-3 py-3" style={FIELD_STYLE}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <GitBranch01 className="size-4 text-tertiary" />
                                    <span className="text-xs font-semibold text-secondary">Version control</span>
                                </div>
                                {onNavigate && (
                                    <button type="button" className="text-[11px] font-medium text-tertiary hover:text-secondary" onClick={() => onNavigate({ kind: "project", id: project.id, tab: "git" })}>
                                        Open Source Control →
                                    </button>
                                )}
                            </div>
                            <p className="mt-1.5 text-[11px] text-quaternary">
                                {repos.length} repo{repos.length === 1 ? "" : "s"}
                                {dirty > 0 ? ` · ${dirty} change${dirty === 1 ? "" : "s"}` : " · clean"}
                                {(adds > 0 || dels > 0) && (
                                    <>
                                        {" · "}
                                        <span className="text-success-primary">+{adds}</span>
                                        {" / "}
                                        <span className="text-error-primary">−{dels}</span>
                                    </>
                                )}
                            </p>
                            {editors.length > 0 && (
                                <ul className="mt-2 flex flex-col gap-1">
                                    {editors.map((c) => (
                                        <li key={c.id} className="flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
                                            <span className="font-medium text-secondary">{c.agentName}</span>
                                            <span className="text-quaternary">{c.tool}</span>
                                            <span className="min-w-0 flex-1 truncate font-mono text-quaternary">{c.path.split(/[\\/]/).pop()}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    );
                })()}

                {picking && (
                    <FolderPicker
                        state={state}
                        actions={actions}
                        title="Choose the project's source folder"
                        initialPath={trimmed || undefined}
                        onPick={(p) => { setPath(p); actions.setProjectSource(project.id, p); setPicking(false); }}
                        onClose={() => setPicking(false)}
                    />
                )}

                {/* Live index status */}
                <div className="mt-4">
                    {status === "indexing" && (
                        <div className="flex items-center gap-2 text-xs text-secondary">
                            <span className="inline-block size-2 animate-pulse rounded-full" style={{ background: "var(--brand)" }} />
                            <span>Scanning {filesScanned} files · {chunks} chunks</span>
                        </div>
                    )}
                    {status === "ready" && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                            <Badge type="pill-color" size="sm" color="success">Ready</Badge>
                            <span>
                                {filesScanned} files · {chunks} code chunks
                                {index?.lastIndexedAt ? ` · ${new Date(index.lastIndexedAt).toLocaleTimeString()}` : ""}
                            </span>
                        </div>
                    )}
                    {status === "error" && <p className="text-xs text-error-primary">{index?.error ?? "Indexing failed."}</p>}
                </div>
            </section>

            {/* Card 2 — Reference documents */}
            <section className="rounded-xl p-5" style={CARD_STYLE}>
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <FileCode02 className="size-5 text-tertiary" />
                        <h2 className="text-sm font-semibold text-primary">Reference documents</h2>
                        <Badge type="pill-color" size="sm" color="gray">{docs.length} doc{docs.length === 1 ? "" : "s"}</Badge>
                    </div>
                    <Badge type="pill-color" size="sm" color="gray">{docChunks} doc chunks</Badge>
                </div>

                <div className="mt-4">
                    <FileDrop
                        accept={ACCEPT}
                        allowsMultiple={false}
                        hint="txt, md, json, csv or code — give it a title & description, then attach"
                        onComplete={(r) => setPending(r)}
                    />
                </div>

                {/* Documents table */}
                {docs.length > 0 ? (
                    <div className="mt-4 overflow-x-auto rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="text-tertiary" style={{ borderBottom: "1px solid var(--c-border)", background: "var(--surface-2)" }}>
                                    <th className="px-3 py-2 font-medium">Document</th>
                                    <th className="px-3 py-2 font-medium">Description</th>
                                    <th className="px-3 py-2 font-medium whitespace-nowrap">Size</th>
                                    <th className="px-3 py-2 font-medium whitespace-nowrap">Uploaded</th>
                                    <th className="px-3 py-2 font-medium whitespace-nowrap">Modified</th>
                                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {docs.map((d) => (
                                    <tr key={d.name} className="align-top transition hover:bg-[var(--surface-2)]" style={{ borderTop: "1px solid var(--c-border)" }}>
                                        <td className="px-3 py-2">
                                            <div className="flex items-start gap-2">
                                                <FileSearch02 className="mt-0.5 size-3.5 shrink-0 text-brand-secondary" />
                                                <div className="min-w-0">
                                                    <div className="truncate font-medium text-primary">{d.title || d.name}</div>
                                                    {d.title && d.title !== d.name && <div className="truncate text-quaternary">{d.name}</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="max-w-[16rem] px-3 py-2 text-secondary">{d.description ? <span className="line-clamp-2">{d.description}</span> : <span className="text-quaternary">—</span>}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-tertiary">{fmtKB(d.bytes)}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-tertiary">{fmtDate(d.addedAt)}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-tertiary">{fmtDate(d.modifiedAt)}</td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center justify-end gap-1">
                                                <button type="button" title="Preview" onClick={() => setPreview(d)} className="rounded p-1.5 text-tertiary transition hover:bg-[var(--surface)] hover:text-primary">
                                                    <Eye className="size-4" />
                                                </button>
                                                <button type="button" title="Edit title & description" onClick={() => setEditing(d)} className="rounded p-1.5 text-tertiary transition hover:bg-[var(--surface)] hover:text-primary">
                                                    <Edit01 className="size-4" />
                                                </button>
                                                <button type="button" title="Remove document" onClick={() => { if (typeof window === "undefined" || window.confirm(`Remove "${d.title || d.name}" from this project?`)) actions.removeProjectDocument(project.id, d.name); }} className="rounded p-1.5 text-tertiary transition hover:bg-[var(--surface)] hover:text-error-primary">
                                                    <Trash01 className="size-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="mt-4 text-xs text-tertiary">No documents attached yet. Drop a file above to add reference context.</p>
                )}
            </section>

            <p className="text-xs text-tertiary">Both source code and reference documents feed the Project Assistant (Chat tab). Removing a document clears its chunks on the next reindex.</p>

            {/* Add-document modal (after upload) */}
            {pending && <DocMetaModal title="Add document" fileName={pending.name} initialTitle={pending.name} initialDescription="" submitLabel="Attach document" onClose={() => setPending(null)} onSubmit={attach} />}

            {/* Edit-document modal */}
            {editing && (
                <DocMetaModal
                    title="Edit document"
                    fileName={editing.name}
                    initialTitle={editing.title ?? editing.name}
                    initialDescription={editing.description ?? ""}
                    submitLabel="Save changes"
                    onClose={() => setEditing(null)}
                    onSubmit={(t, desc) => { actions.updateProjectDocument(project.id, editing.name, { title: t.trim() || editing.name, description: desc.trim() }); setEditing(null); }}
                />
            )}

            {/* Preview modal */}
            {preview && <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />}
        </div>
    );
};

/** Shared modal for setting a document's title + description (add or edit). */
const DocMetaModal = ({ title, fileName, initialTitle, initialDescription, submitLabel, onClose, onSubmit }: {
    title: string;
    fileName: string;
    initialTitle: string;
    initialDescription: string;
    submitLabel: string;
    onClose: () => void;
    onSubmit: (title: string, description: string) => void;
}) => {
    const [t, setT] = useState(initialTitle);
    const [desc, setDesc] = useState(initialDescription);
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl" style={CARD_STYLE} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <h2 className="text-sm font-semibold text-primary">{title}</h2>
                    <button type="button" onClick={onClose} className="rounded p-1 text-quaternary hover:text-secondary">✕</button>
                </div>
                <div className="flex flex-col gap-4 p-5">
                    <div className="flex items-center gap-2 text-xs text-tertiary">
                        <FileCode02 className="size-4 text-brand-secondary" />
                        <span className="truncate">{fileName}</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-medium text-secondary">Title</span>
                        <input value={t} onChange={(e) => setT(e.target.value)} placeholder={fileName} className="w-full rounded-lg px-3 py-2 text-sm text-primary outline-none" style={FIELD_STYLE} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-medium text-secondary">Description</span>
                        <TextArea value={desc} onChange={setDesc} rows={4} placeholder="What is this document, and how should the assistant use it?" />
                    </div>
                </div>
                <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" onClick={() => onSubmit(t, desc)}>{submitLabel}</Button>
                </div>
            </div>
        </div>
    );
};

/** Read-only preview of a document's retained text (first ~6KB). */
const DocPreviewModal = ({ doc, onClose }: { doc: ProjectDocMeta; onClose: () => void }) => {
    const isImage = (doc.mime ?? "").startsWith("image/");
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl" style={CARD_STYLE} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-primary">{doc.title || doc.name}</h2>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
                            <span>{doc.name}</span>
                            <span>· {fmtKB(doc.bytes)}</span>
                            {doc.mime && <span>· {doc.mime}</span>}
                            <span className="flex items-center gap-1"><Clock className="size-3" /> {fmtDate(doc.modifiedAt ?? doc.addedAt)}</span>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="ml-3 shrink-0 rounded p-1 text-quaternary hover:text-secondary">✕</button>
                </div>
                {doc.description && <p className="border-b px-5 py-3 text-xs text-secondary" style={{ borderColor: "var(--c-border)" }}>{doc.description}</p>}
                <div className="min-h-0 flex-1 overflow-auto p-5">
                    {isImage ? (
                        <p className="text-xs text-tertiary">Binary image file — no text preview available. The image content is embedded in the project index.</p>
                    ) : doc.preview ? (
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-secondary">{doc.preview}</pre>
                    ) : (
                        <p className="text-xs text-tertiary">No preview retained for this document.</p>
                    )}
                </div>
            </div>
        </div>
    );
};
