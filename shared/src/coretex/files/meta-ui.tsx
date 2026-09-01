// @ts-nocheck
"use client";

// Coretex Files — metadata UI: custom-or-auto entry icons, tag emblems, the
// per-entry Customize slideout (icon library / emoji / upload / color / tags),
// and the Tag manager. Persists via the filesMeta* actions (sidecar meta DB).

import { useState, type CSSProperties } from "react";
import { Tag01, Plus, Trash01, X, Check, RefreshCcw02, FaceSmile, Image01, Folder } from "@untitledui/icons";
import type { FilePathMeta, FileTag } from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { cx } from "@/utils/cx";
import type { CoretexActions } from "../use-coretex";
import { resolveProjectIcon } from "../ui/project-icon";
import { IconPicker } from "../ui/icon-picker";
import { ColorPicker, COLOR_SWATCHES } from "../ui/color-picker";
import { entryIcon } from "./file-icons";

// ---- entry icon (custom override → auto) ----
export const MetaEntryIcon = ({ name, isDir, px, meta }: { name: string; isDir: boolean; px: number; meta?: FilePathMeta }) => {
    const icon = meta?.icon;
    const base: CSSProperties = { width: px, height: px };
    if (icon?.kind === "emoji" && icon.value) {
        return <span style={{ fontSize: Math.round(px * 0.92), lineHeight: 1 }}>{icon.value}</span>;
    }
    if (icon?.kind === "upload" && icon.value) {
        return <img src={icon.value} alt="" style={{ ...base, objectFit: "contain", borderRadius: 4 }} />;
    }
    if (icon?.kind === "library" && icon.value) {
        const Cmp = resolveProjectIcon(icon.value);
        return <Cmp style={{ ...base, color: meta?.color || "var(--brand)" }} />;
    }
    const auto = entryIcon(name, isDir);
    const Cmp = resolveProjectIcon(auto.icon);
    return <Cmp style={{ ...base, color: meta?.color || auto.color }} />;
};

// ---- tag emblem dots ----
export const TagDots = ({ tagIds, tags, max = 3, className }: { tagIds?: string[]; tags: FileTag[]; max?: number; className?: string }) => {
    const resolved = (tagIds ?? []).map((id) => tags.find((t) => t.id === id)).filter((t): t is FileTag => Boolean(t));
    if (resolved.length === 0) return null;
    return (
        <span className={cx("flex items-center gap-0.5", className)}>
            {resolved.slice(0, max).map((t) => (
                <span key={t.id} className="size-1.5 rounded-full" style={{ background: t.color }} title={t.name} />
            ))}
        </span>
    );
};

// ---- Customize slideout ----
type IconMode = "auto" | "library" | "emoji" | "upload";

export const CustomizeSlideout = ({
    target,
    meta,
    tags,
    actions,
    onClose,
}: {
    target: { path: string; name: string; isDir: boolean } | null;
    meta?: FilePathMeta;
    tags: FileTag[];
    actions: CoretexActions;
    onClose: () => void;
}) => {
    if (!target) {
        return <SlideoutMenu isOpen={false} onOpenChange={() => onClose()}><div /></SlideoutMenu>;
    }
    return <CustomizeBody key={target.path} target={target} meta={meta} tags={tags} actions={actions} onClose={onClose} />;
};

const CustomizeBody = ({
    target,
    meta,
    tags,
    actions,
    onClose,
}: {
    target: { path: string; name: string; isDir: boolean };
    meta?: FilePathMeta;
    tags: FileTag[];
    actions: CoretexActions;
    onClose: () => void;
}) => {
    const [mode, setMode] = useState<IconMode>(meta?.icon?.kind ?? "auto");
    const [emoji, setEmoji] = useState(meta?.icon?.kind === "emoji" ? (meta.icon.value ?? "") : "");
    const tagIds = meta?.tagIds ?? [];
    const [newTag, setNewTag] = useState("");
    const [name, setName] = useState(target.name);
    const [delArmed, setDelArmed] = useState(false);

    const parentDir = target.path.slice(0, target.path.length - target.name.length);
    const rename = () => {
        const n = name.trim();
        if (!n || n === target.name) return;
        actions.fsMove(target.path, parentDir + n);
        onClose();
    };
    const del = () => {
        if (!delArmed) { setDelArmed(true); window.setTimeout(() => setDelArmed(false), 3000); return; }
        actions.fsDelete(target.path);
        onClose();
    };

    const setIcon = (icon: FilePathMeta["icon"]) => actions.filesMetaSetPath(target.path, { icon });
    const setColor = (color: string) => actions.filesMetaSetPath(target.path, { color: color || undefined });
    const toggleTag = (id: string) => {
        const next = tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id];
        actions.filesMetaSetPathTags([target.path], next);
    };
    const createTag = () => {
        const name = newTag.trim();
        if (!name) return;
        const id = `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
        const color = COLOR_SWATCHES[(tags.length + 1) % COLOR_SWATCHES.length].value;
        actions.filesMetaUpsertTag({ id, name, color });
        actions.filesMetaSetPathTags([target.path], [...tagIds, id]);
        setNewTag("");
    };

    const MODES: { id: IconMode; label: string; icon: typeof Folder }[] = [
        { id: "auto", label: "Auto", icon: RefreshCcw02 },
        { id: "library", label: "Icon", icon: Folder },
        { id: "emoji", label: "Emoji", icon: FaceSmile },
        { id: "upload", label: "Image", icon: Image01 },
    ];

    const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setIcon({ kind: "upload", value: typeof reader.result === "string" ? reader.result : "" });
        reader.readAsDataURL(file);
    };

    return (
        <SlideoutMenu isOpen onOpenChange={(v) => !v && onClose()} isDismissable dialogClassName="gap-0">
            <SlideoutMenu.Header onClose={onClose}>
                <div className="flex items-center gap-2.5">
                    <MetaEntryIcon name={target.name} isDir={target.isDir} px={28} meta={meta} />
                    <div className="min-w-0">
                        <h1 className="truncate text-md font-semibold text-primary">{target.name}</h1>
                        <p className="truncate text-xs text-tertiary">{target.path}</p>
                    </div>
                </div>
            </SlideoutMenu.Header>

            <SlideoutMenu.Content className="py-6">
                <div className="flex flex-col gap-6">
                    {/* Rename */}
                    <section className="flex flex-col gap-2.5">
                        <p className="text-sm font-semibold text-primary">Name</p>
                        <div className="flex items-center gap-2">
                            <Input value={name} onChange={setName} onKeyDown={(e) => e.key === "Enter" && rename()} size="sm" className="flex-1" />
                            <Button size="sm" color="secondary" onClick={rename} isDisabled={!name.trim() || name === target.name}>Rename</Button>
                        </div>
                    </section>

                    {/* Icon */}
                    <section className="flex flex-col gap-2.5">
                        <p className="text-sm font-semibold text-primary">Icon</p>
                        <div className="flex overflow-hidden rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                            {MODES.map((m) => (
                                <button key={m.id} type="button" onClick={() => { setMode(m.id); if (m.id === "auto") setIcon({ kind: "auto" }); }} className={cx("flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition", mode === m.id ? "text-primary" : "text-tertiary")} style={{ background: mode === m.id ? "var(--surface-2)" : "transparent" }}>
                                    <m.icon className="size-3.5" /> {m.label}
                                </button>
                            ))}
                        </div>
                        {mode === "auto" && <p className="text-xs text-quaternary">Smart icon chosen automatically from the {target.isDir ? "folder" : "file"} type.</p>}
                        {mode === "library" && <IconPicker value={meta?.icon?.kind === "library" ? meta.icon.value : undefined} color={meta?.color} onChange={(n) => setIcon({ kind: "library", value: n })} />}
                        {mode === "emoji" && (
                            <div className="flex items-center gap-2">
                                <Input value={emoji} onChange={(v) => setEmoji(v.slice(-2))} onBlur={() => emoji && setIcon({ kind: "emoji", value: emoji })} placeholder="🚀" className="w-16" inputClassName="text-center text-xl" />
                                <span className="text-xs text-quaternary">Type or paste an emoji.</span>
                            </div>
                        )}
                        {mode === "upload" && (
                            <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-center transition hover:bg-[var(--surface-2)]" style={{ borderColor: "var(--c-border)" }}>
                                <Image01 className="size-5 text-tertiary" />
                                <span className="text-xs text-secondary">Upload an image / SVG</span>
                                <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
                            </label>
                        )}
                    </section>

                    {/* Color */}
                    <section className="flex flex-col gap-2.5">
                        <p className="text-sm font-semibold text-primary">Color</p>
                        <ColorPicker value={meta?.color ?? ""} onChange={setColor} />
                    </section>

                    {/* Tags */}
                    <section className="flex flex-col gap-2.5">
                        <p className="text-sm font-semibold text-primary">Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                            {tags.map((t) => {
                                const on = tagIds.includes(t.id);
                                return (
                                    <button key={t.id} type="button" onClick={() => toggleTag(t.id)} className={cx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition", on ? "" : "opacity-60 hover:opacity-100")} style={on ? { background: t.color + "26", color: t.color, border: `1px solid ${t.color}` } : { border: "1px solid var(--c-border)", color: "var(--c-text-secondary)" }}>
                                        <span className="size-2 rounded-full" style={{ background: t.color }} /> {t.name}
                                        {on && <Check className="size-3" />}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center gap-2">
                            <Input value={newTag} onChange={setNewTag} onKeyDown={(e) => e.key === "Enter" && createTag()} placeholder="New tag…" size="sm" className="flex-1" />
                            <Button size="sm" color="secondary" iconLeading={Plus} onClick={createTag} isDisabled={!newTag.trim()}>Create</Button>
                        </div>
                    </section>
                </div>
            </SlideoutMenu.Content>

            <SlideoutMenu.Footer className="flex w-full items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <Button size="sm" color="primary-destructive" iconLeading={Trash01} onClick={del}>{delArmed ? "Confirm delete" : "Delete"}</Button>
                    <Button size="sm" color="link-gray" onClick={() => { actions.filesMetaClearPath(target.path); onClose(); }}>Reset style</Button>
                </div>
                <Button size="sm" color="secondary" onClick={onClose}>Done</Button>
            </SlideoutMenu.Footer>
        </SlideoutMenu>
    );
};

// ---- Tag manager modal ----
export const TagManager = ({ tags, actions, onClose }: { tags: FileTag[]; actions: CoretexActions; onClose: () => void }) => {
    const [name, setName] = useState("");
    const [color, setColor] = useState(COLOR_SWATCHES[1].value);

    const create = () => {
        const n = name.trim();
        if (!n) return;
        actions.filesMetaUpsertTag({ id: `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, name: n, color });
        setName("");
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-secondary px-5 py-3">
                    <h2 className="flex items-center gap-2 text-md font-semibold text-primary"><Tag01 className="size-4 text-[var(--brand)]" /> Tags</h2>
                    <button type="button" onClick={onClose} className="rounded p-1 text-quaternary hover:text-secondary"><X className="size-4" /></button>
                </div>
                <div className="flex flex-col gap-3 p-5">
                    {/* Create */}
                    <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                        <Input value={name} onChange={setName} placeholder="Tag name" size="sm" />
                        <ColorPicker value={color} onChange={setColor} allowCustom={false} />
                        <Button size="sm" color="primary" iconLeading={Plus} onClick={create} isDisabled={!name.trim()}>Create tag</Button>
                    </div>
                    {/* List */}
                    <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                        {tags.length === 0 ? (
                            <p className="py-3 text-center text-xs text-quaternary">No tags yet.</p>
                        ) : (
                            tags.map((t) => (
                                <div key={t.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
                                    <span className="size-3 rounded-full" style={{ background: t.color }} />
                                    <input
                                        value={t.name}
                                        onChange={(e) => actions.filesMetaUpsertTag({ ...t, name: e.target.value })}
                                        className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none"
                                    />
                                    <Badge size="sm" color="gray">{t.id.slice(0, 6)}</Badge>
                                    <button type="button" onClick={() => actions.filesMetaDeleteTag(t.id)} title="Delete" className="rounded p-1 text-error-primary hover:bg-[var(--surface)]"><Trash01 className="size-3.5" /></button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
