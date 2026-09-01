// @ts-nocheck
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, X, Image01, Film02, Download01, Edit01, Trash01, MarkerPin01, Calendar, Camera01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { TextInput, TextareaInput, DateInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/social/ui";
import { fileUrl } from "@/lib/files";
import { fmtDate, toDateInput, fmtBytes } from "@/lib/social/format";
import { cx } from "@/utils/cx";

export type MemoryMedia = { id: string; key: string; fileName: string; mimeType: string; sizeBytes: number | null };
export type Memory = {
    id: string;
    title: string | null;
    description: string;
    memoryDate: string | null;
    location: string | null;
    media: MemoryMedia[];
    legacyKeys: string[];
};

type AddAction = (formData: FormData) => Promise<void>;
type UpdateAction = (formData: FormData) => Promise<void>;
type DeleteAction = (formData: FormData) => Promise<void>;

function isVideo(mime: string) {
    return mime.startsWith("video/");
}

/** Media tile keyed by storage key (for saved memories), with download link. */
function SavedMediaTile({
    storageKey,
    name,
    mime,
}: {
    storageKey: string;
    name: string;
    mime: string;
}) {
    return (
        <div className="group relative overflow-hidden rounded-lg ring-1 ring-secondary">
            {isVideo(mime) ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={fileUrl(storageKey)} controls className="h-28 w-full bg-black object-cover" preload="metadata" />
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(storageKey)} alt={name} className="h-28 w-full object-cover" loading="lazy" />
            )}
            <a
                href={fileUrl(storageKey, { download: true, name })}
                download={name}
                aria-label={`Download ${name}`}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-primary/90 text-fg-secondary opacity-0 ring-1 ring-secondary transition hover:text-fg-brand-primary group-hover:opacity-100"
            >
                <Download01 className="size-3.5" aria-hidden="true" />
            </a>
        </div>
    );
}

/** Form fields shared by add/edit memory dialogs, plus client-side media staging. */
function MemoryFields({
    memory,
    removeIds,
    removeKeys,
    onToggleRemoveId,
    onToggleRemoveKey,
}: {
    memory?: Memory;
    removeIds: Set<string>;
    removeKeys: Set<string>;
    onToggleRemoveId: (id: string) => void;
    onToggleRemoveKey: (key: string) => void;
}) {
    const [files, setFiles] = useState<File[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    function addFiles(list: FileList | null) {
        if (!list) return;
        setFiles((prev) => [...prev, ...Array.from(list)]);
    }

    return (
        <>
            <TextInput name="title" label="Title" defaultValue={memory?.title ?? ""} placeholder="e.g. Road trip to the coast" />
            <TextareaInput name="description" label="Description" rows={3} isRequired defaultValue={memory?.description ?? ""} />
            <div className="grid grid-cols-2 gap-4">
                <DateInput name="memoryDate" label="Date" defaultValue={toDateInput(memory?.memoryDate ?? null)} />
                <TextInput name="location" label="Location" defaultValue={memory?.location ?? ""} placeholder="Where" />
            </div>

            {/* Existing saved media (edit mode) — toggle removal. */}
            {memory && (memory.media.length > 0 || memory.legacyKeys.length > 0) && (
                <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-secondary">Current media</span>
                    <div className="grid grid-cols-3 gap-2">
                        {memory.media.map((m) => {
                            const marked = removeIds.has(m.id);
                            return (
                                <div key={m.id} className={cx("relative overflow-hidden rounded-lg ring-1 ring-secondary", marked && "opacity-40")}>
                                    {isVideo(m.mimeType) ? (
                                        // eslint-disable-next-line jsx-a11y/media-has-caption
                                        <video src={fileUrl(m.key)} className="h-20 w-full bg-black object-cover" preload="metadata" />
                                    ) : (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={fileUrl(m.key)} alt={m.fileName} className="h-20 w-full object-cover" loading="lazy" />
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onToggleRemoveId(m.id)}
                                        aria-label={marked ? `Keep ${m.fileName}` : `Remove ${m.fileName}`}
                                        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary/90 text-fg-error-primary ring-1 ring-secondary"
                                    >
                                        <X className="size-3" aria-hidden="true" />
                                    </button>
                                </div>
                            );
                        })}
                        {memory.legacyKeys.map((k) => {
                            const marked = removeKeys.has(k);
                            return (
                                <div key={k} className={cx("relative overflow-hidden rounded-lg ring-1 ring-secondary", marked && "opacity-40")}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={fileUrl(k)} alt="" className="h-20 w-full object-cover" loading="lazy" />
                                    <button
                                        type="button"
                                        onClick={() => onToggleRemoveKey(k)}
                                        aria-label="Remove media"
                                        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary/90 text-fg-error-primary ring-1 ring-secondary"
                                    >
                                        <X className="size-3" aria-hidden="true" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    {[...removeIds].map((id) => (
                        <input key={id} type="hidden" name="removeMediaIds" value={id} />
                    ))}
                    {[...removeKeys].map((k) => (
                        <input key={k} type="hidden" name="removeMediaKeys" value={k} />
                    ))}
                </div>
            )}

            {/* New uploads. Use a single carrier input synced from staged files. */}
            <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-secondary">Add photos & videos</span>
                <input
                    ref={inputRef}
                    type="file"
                    name="media"
                    multiple
                    accept="image/*,video/*"
                    onChange={(e) => addFiles(e.target.files)}
                    className="block w-full text-sm text-tertiary file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary hover:file:bg-secondary_hover"
                />
                <p className="text-xs text-tertiary">Any image or video type, multiple allowed.</p>
                {files.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-1">
                        {files.map((f, i) => (
                            <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-secondary">
                                {f.type.startsWith("video/") ? <Film02 className="size-3.5" aria-hidden="true" /> : <Image01 className="size-3.5" aria-hidden="true" />}
                                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                <span className="text-tertiary">{fmtBytes(f.size)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </>
    );
}

function MemoryDialog({
    open,
    onOpenChange,
    memory,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    memory?: Memory;
    onSubmit: (fd: FormData) => Promise<void>;
}) {
    const [removeIds, setRemoveIds] = useState<Set<string>>(new Set());
    const [removeKeys, setRemoveKeys] = useState<Set<string>>(new Set());

    function toggle(set: Set<string>, setter: (s: Set<string>) => void, v: string) {
        const next = new Set(set);
        if (next.has(v)) next.delete(v);
        else next.add(v);
        setter(next);
    }

    async function handle(fd: FormData) {
        try {
            await onSubmit(fd);
            toast.success(memory ? "Memory updated" : "Memory saved");
            onOpenChange(false);
            setRemoveIds(new Set());
            setRemoveKeys(new Set());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    const title = memory ? "Edit memory" : "Add memory";

    return (
        <ModalOverlay isDismissable isOpen={open} onOpenChange={onOpenChange}>
            <Modal className="max-w-lg">
                <Dialog aria-label={title}>
                    <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                        <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                            <h2 className="text-md font-semibold text-primary">{title}</h2>
                            <Button color="tertiary" size="sm" iconLeading={X} onClick={() => onOpenChange(false)} aria-label="Close" />
                        </div>
                        <form action={handle} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
                            {memory && <input type="hidden" name="id" value={memory.id} />}
                            <MemoryFields
                                memory={memory}
                                removeIds={removeIds}
                                removeKeys={removeKeys}
                                onToggleRemoveId={(id) => toggle(removeIds, setRemoveIds, id)}
                                onToggleRemoveKey={(k) => toggle(removeKeys, setRemoveKeys, k)}
                            />
                            <div className="flex justify-end gap-2 pt-1">
                                <Button color="secondary" onClick={() => onOpenChange(false)}>
                                    Cancel
                                </Button>
                                <SubmitButton color="primary">{memory ? "Save" : "Save memory"}</SubmitButton>
                            </div>
                        </form>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

export function MemoriesManager({
    memories,
    addAction,
    updateAction,
    deleteAction,
}: {
    memories: Memory[];
    addAction: AddAction;
    updateAction: UpdateAction;
    deleteAction: DeleteAction;
}) {
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<Memory | null>(null);
    const { confirm, dialog } = useConfirm();

    async function remove(m: Memory) {
        const fd = new FormData();
        fd.set("id", m.id);
        try {
            await deleteAction(fd);
            toast.success("Memory deleted");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to delete");
        }
    }

    return (
        <Card>
            <CardHeader
                title="Memories"
                action={
                    <Button color="primary" size="sm" iconLeading={Plus} onClick={() => setAdding(true)}>
                        Add memory
                    </Button>
                }
            />
            <CardBody>
                {memories.length === 0 ? (
                    <EmptyState
                        icon={Camera01}
                        title="No memories yet"
                        description="Hold on to the moments that matter — add photos, videos, and the story behind them."
                        action={{ label: "Add a memory", onClick: () => setAdding(true) }}
                    />
                ) : (
                    <ul className="flex flex-col gap-5">
                        {memories.map((m) => {
                            const imgCount = m.media.filter((x) => !isVideo(x.mimeType)).length + m.legacyKeys.length;
                            const vidCount = m.media.filter((x) => isVideo(x.mimeType)).length;
                            return (
                                <li key={m.id} className="flex flex-col gap-3 border-b border-secondary pb-5 last:border-0 last:pb-0">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            {m.title && <h3 className="font-medium text-primary">{m.title}</h3>}
                                            <p className="whitespace-pre-wrap text-sm text-primary">{m.description}</p>
                                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
                                                {m.memoryDate && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <Calendar className="size-3" aria-hidden="true" /> {fmtDate(m.memoryDate)}
                                                    </span>
                                                )}
                                                {m.location && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <MarkerPin01 className="size-3" aria-hidden="true" /> {m.location}
                                                    </span>
                                                )}
                                                {imgCount > 0 && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <Image01 className="size-3" aria-hidden="true" /> {imgCount}
                                                    </span>
                                                )}
                                                {vidCount > 0 && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <Film02 className="size-3" aria-hidden="true" /> {vidCount}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 gap-1">
                                            <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setEditing(m)} aria-label="Edit memory" />
                                            <Button
                                                color="tertiary-destructive"
                                                size="sm"
                                                iconLeading={Trash01}
                                                aria-label="Delete memory"
                                                onClick={() =>
                                                    confirm({
                                                        title: "Delete memory?",
                                                        description: "This removes the memory and all its media.",
                                                        confirmLabel: "Delete",
                                                        onConfirm: () => remove(m),
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>
                                    {(m.media.length > 0 || m.legacyKeys.length > 0) && (
                                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                                            {m.media.map((md) => (
                                                <SavedMediaTile key={md.id} storageKey={md.key} name={md.fileName} mime={md.mimeType} />
                                            ))}
                                            {m.legacyKeys.map((k) => (
                                                <SavedMediaTile key={k} storageKey={k} name="memory" mime="image/*" />
                                            ))}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardBody>

            <MemoryDialog open={adding} onOpenChange={setAdding} onSubmit={addAction} />
            <MemoryDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} memory={editing ?? undefined} onSubmit={updateAction} />
            {dialog}
        </Card>
    );
}
