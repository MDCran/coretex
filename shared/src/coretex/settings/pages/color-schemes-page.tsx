"use client";

// Coretex — Color schemes settings (§7). Manage terminal color schemes:
// create blank duplicates, import from JSON, preview against a mini terminal,
// and delete/duplicate. Schemes live in the `colorSchemes` array collection, so
// every mutation computes the WHOLE next array and calls actions.updateSettings.
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { ColorScheme, CoretexConfig } from "@repo/coretex/types";
import { CheckCircle, Colors, Edit01, Plus, Trash01, Upload01, XClose } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { cx } from "@/utils/cx";
import { ColorPicker } from "../../ui/color-picker";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";

// The six named (non-ANSI) color fields, in editor order.
const NAMED_KEYS = ["background", "foreground", "cursor", "cursorAccent", "selectionBackground", "selectionForeground"] as const;
const NAMED_LABELS: Record<(typeof NAMED_KEYS)[number], string> = {
    background: "Background",
    foreground: "Foreground",
    cursor: "Cursor",
    cursorAccent: "Cursor accent",
    selectionBackground: "Selection bg",
    selectionForeground: "Selection fg",
};

interface ColorSchemesPageProps {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
}

// The 16 ANSI color keys in their canonical order (black..brightWhite).
const ANSI_KEYS = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "purple",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightPurple",
    "brightCyan",
    "brightWhite",
] as const;

// A safe fallback scheme used when neither "Coretex Dark" nor any scheme exists,
// and as the base for best-effort coercion of imported JSON.
const FALLBACK_SCHEME: ColorScheme = {
    name: "Custom scheme",
    builtIn: false,
    background: "#0b0e14",
    foreground: "#bfbdb6",
    cursor: "#e6b450",
    cursorAccent: "#0b0e14",
    selectionBackground: "#273747",
    selectionForeground: "#bfbdb6",
    black: "#0b0e14",
    red: "#ea6c73",
    green: "#7fd962",
    yellow: "#f9af4f",
    blue: "#53bdfa",
    purple: "#cda1fa",
    cyan: "#90e1c6",
    white: "#c7c7c7",
    brightBlack: "#686868",
    brightRed: "#f07178",
    brightGreen: "#aad94c",
    brightYellow: "#ffb454",
    brightBlue: "#59c2ff",
    brightPurple: "#d2a6ff",
    brightCyan: "#95e6cb",
    brightWhite: "#ffffff",
};

function str(value: unknown, fallback: string): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Best-effort map an arbitrary parsed JSON object onto the ColorScheme shape. */
function coerceScheme(raw: unknown, base: ColorScheme): ColorScheme {
    const obj = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const next: ColorScheme = { ...base, builtIn: false };
    next.name = str(obj.name, "Imported scheme");
    next.background = str(obj.background, base.background);
    next.foreground = str(obj.foreground, base.foreground);
    next.cursor = str(obj.cursor ?? obj.cursorColor, base.cursor);
    next.cursorAccent = str(obj.cursorAccent, base.cursorAccent);
    next.selectionBackground = str(obj.selectionBackground ?? obj.selection, base.selectionBackground);
    next.selectionForeground = str(obj.selectionForeground, base.selectionForeground);
    for (const key of ANSI_KEYS) {
        // Accept both our key names and a common "brightPurple"->"brightMagenta" alias.
        const alias = key === "purple" ? "magenta" : key === "brightPurple" ? "brightMagenta" : key;
        next[key] = str(obj[key] ?? obj[alias], base[key]);
    }
    return next;
}

/** A scheme named "Custom scheme (n)" that does not collide with existing names. */
function uniqueName(base: string, existing: ColorScheme[]): string {
    const names = new Set(existing.map((s) => s.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
}

export const ColorSchemesPage = ({ settings, actions }: ColorSchemesPageProps) => {
    const schemes: ColorScheme[] = Array.isArray(settings.colorSchemes) ? settings.colorSchemes : [];
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const deletion = useConfirm();
    const [importError, setImportError] = useState<string | null>(null);
    // The original name of the scheme open in the full editor (matched on save), or null.
    const [editingName, setEditingName] = useState<string | null>(null);
    const editing = editingName ? (schemes.find((s) => s.name === editingName && !s.builtIn) ?? null) : null;
    const activeName = settings.appearance.application.activeColorScheme ?? null;
    const setActive = (name: string | null): void => {
        actions.setSetting("appearance.application.activeColorScheme", name);
    };

    const baseDark = (): ColorScheme => schemes.find((s) => s.name === "Coretex Dark") ?? schemes[0] ?? FALLBACK_SCHEME;

    const appendScheme = (scheme: ColorScheme) => {
        actions.updateSettings({ colorSchemes: [...schemes, scheme] });
    };

    const handleNewScheme = () => {
        const dup: ColorScheme = { ...baseDark(), name: uniqueName("Custom scheme", schemes), builtIn: false };
        appendScheme(dup);
        setEditingName(dup.name); // jump straight into the editor on the new copy
    };

    const handleDuplicate = (source: ColorScheme) => {
        const dup: ColorScheme = { ...source, name: uniqueName(`${source.name} copy`, schemes), builtIn: false };
        appendScheme(dup);
        setEditingName(dup.name);
    };

    const handleDelete = (target: ColorScheme) => {
        const updated = schemes.filter((s) => s !== target);
        if (activeName === target.name) setActive(null); // don't leave a dangling active pointer
        actions.updateSettings({ colorSchemes: updated });
    };

    const requestDelete = (target: ColorScheme) => {
        deletion.confirm({
            title: `Delete ${target.name}?`,
            description: "This permanently removes the custom palette. Profiles using it will fall back to their default colors.",
            confirmLabel: "Delete scheme",
            onConfirm: () => handleDelete(target),
        });
    };

    /** Save the edited draft back into the array (matched by its original name); update the
        active pointer if the active scheme was renamed. */
    const handleSaveEdit = (orig: string, draft: ColorScheme) => {
        const next = schemes.map((s) => (s.name === orig ? draft : s));
        actions.updateSettings({ colorSchemes: next });
        if (activeName === orig && draft.name !== orig) setActive(draft.name);
        setEditingName(null);
    };

    const handleImportClick = () => {
        setImportError(null);
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // Reset the input so re-selecting the same file fires change again.
        event.target.value = "";
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = typeof reader.result === "string" ? reader.result : "";
                const parsed = JSON.parse(text) as unknown;
                const coerced = coerceScheme(parsed, baseDark());
                coerced.name = uniqueName(coerced.name, schemes);
                appendScheme(coerced);
                setImportError(null);
            } catch {
                setImportError(`Could not parse ${file.name} — expected a JSON color scheme.`);
            }
        };
        reader.onerror = () => setImportError(`Could not read ${file.name}.`);
        reader.readAsText(file);
    };

    return (
        <div className="flex flex-col gap-6">
            {deletion.dialog}
            <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />

            <SettingsPageHeader
                icon={Colors}
                title="Color schemes"
                subtitle="Pick a scheme to recolor the whole app live, or duplicate one to edit. Built-in schemes are read-only."
                badges={<SettingsStatusBadge label={activeName ? `${activeName} active` : "Theme colors active"} color={activeName ? "brand" : "gray"} />}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" color="secondary" iconLeading={Upload01} onClick={handleImportClick}>
                            Import JSON
                        </Button>
                        <Button size="sm" color="primary" iconLeading={Plus} onClick={handleNewScheme}>
                            New scheme
                        </Button>
                    </div>
                }
            />

            <SettingsSection
                title="Terminal palettes"
                description={`${schemes.length} scheme${schemes.length === 1 ? "" : "s"} available. Select a card to apply it immediately.`}
            >
                <div className="flex flex-col gap-5">
                    {importError && (
                        <p
                            role="alert"
                            className="rounded-lg px-3 py-2 text-xs text-error-primary"
                            style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                        >
                            {importError}
                        </p>
                    )}

                    {/* Active selection: Default (theme colors) + each scheme is a "Set active" target on its card. */}
                    <div
                        className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-3"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                    >
                        <span className="text-sm font-medium text-secondary">Active scheme</span>
                        <Badge size="sm" color={activeName ? "brand" : "gray"}>
                            {activeName ?? "Default (theme colors)"}
                        </Badge>
                        {activeName && (
                            <Button size="sm" color="link-color" className="sm:ml-auto" onClick={() => setActive(null)}>
                                Reset to default
                            </Button>
                        )}
                    </div>

                    {schemes.length === 0 ? (
                        <div
                            className="rounded-xl p-8 text-center text-sm text-tertiary"
                            style={{ background: "var(--surface-2)", border: "1px dashed var(--c-border)" }}
                        >
                            No color schemes yet. Create one or import a JSON palette.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            {schemes.map((scheme, index) => (
                                <SchemeCard
                                    key={`${scheme.name}-${index}`}
                                    scheme={scheme}
                                    active={activeName === scheme.name}
                                    onActivate={() => setActive(scheme.name)}
                                    onDelete={() => requestDelete(scheme)}
                                    onDuplicate={() => handleDuplicate(scheme)}
                                    onEdit={() => setEditingName(scheme.name)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </SettingsSection>

            {editing && (
                <SchemeEditor
                    scheme={editing}
                    otherNames={schemes.filter((s) => s.name !== editing.name).map((s) => s.name)}
                    onSave={(draft) => handleSaveEdit(editing.name, draft)}
                    onClose={() => setEditingName(null)}
                />
            )}
        </div>
    );
};

interface SchemeCardProps {
    scheme: ColorScheme;
    active: boolean;
    onActivate: () => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onEdit: () => void;
}

const SchemeCard = ({ scheme, active, onActivate, onDelete, onDuplicate, onEdit }: SchemeCardProps) => {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={active ? undefined : onActivate}
            onKeyDown={(e) => {
                if (!active && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onActivate();
                }
            }}
            title={active ? "Active scheme" : "Click to set active"}
            className={cx("group overflow-hidden rounded-xl transition-shadow hover:shadow-lg", !active && "cursor-pointer")}
            style={{ border: active ? "2px solid var(--brand)" : "1px solid var(--c-border)" }}
        >
            {/* Mini terminal preview rendered with the scheme's own colors. */}
            <div className="p-4 font-mono text-xs" style={{ background: scheme.background, color: scheme.foreground }}>
                <div style={{ color: scheme.green }}>$ coretex connect web-01</div>
                <div className="mt-1" style={{ color: scheme.foreground }}>
                    Connected to 10.0.1.10
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                    {ANSI_KEYS.map((key) => (
                        <span
                            key={key}
                            title={`${key}: ${scheme[key]}`}
                            style={{
                                width: 14,
                                height: 14,
                                background: scheme[key],
                                borderRadius: 3,
                                border: "1px solid rgba(255,255,255,0.12)",
                            }}
                        />
                    ))}
                </div>
            </div>

            {/* Footer bar with the name, built-in badge, and per-scheme actions. */}
            <div
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                style={{ background: "var(--surface)", borderTop: "1px solid var(--c-border)" }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
            >
                <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 break-words text-sm font-medium text-primary" title={scheme.name}>{scheme.name}</span>
                    {active && (
                        <Badge size="sm" color="brand" type="pill-color">
                            Active
                        </Badge>
                    )}
                    {scheme.builtIn && (
                        <Badge size="sm" color="gray">
                            Built-in
                        </Badge>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                    {active ? (
                        <Button size="sm" color="link-color" iconLeading={CheckCircle} isDisabled>
                            Active
                        </Button>
                    ) : (
                        <Button size="sm" color="secondary" onClick={onActivate}>
                            Set active
                        </Button>
                    )}
                    <Button size="sm" color="link-color" onClick={onDuplicate}>
                        Duplicate
                    </Button>
                    {!scheme.builtIn && (
                        <>
                            <Button size="sm" color="secondary" iconLeading={Edit01} onClick={onEdit}>
                                Edit
                            </Button>
                            <Button size="sm" color="primary-destructive" iconLeading={Trash01} onClick={onDelete} aria-label="Delete scheme" />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

// ---- Full color-scheme editor (all ~20 fields + rename + live preview) ----
const ColorField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-xs font-medium text-secondary">{label}</span>
        <div className="min-w-0 flex-1">
            <ColorPicker variant="compact" allowNone={false} value={value} onChange={onChange} />
        </div>
    </div>
);

const SchemeEditor = ({
    scheme,
    otherNames,
    onSave,
    onClose,
}: {
    scheme: ColorScheme;
    otherNames: string[];
    onSave: (draft: ColorScheme) => void;
    onClose: () => void;
}) => {
    const [draft, setDraft] = useState<ColorScheme>({ ...scheme });
    const set = (k: keyof ColorScheme, v: string) => setDraft((d) => ({ ...d, [k]: v }));
    const nameTrim = draft.name.trim();
    const nameClash = otherNames.includes(nameTrim);
    const valid = nameTrim.length > 0 && !nameClash;
    return (
        <ModalOverlay
            isOpen
            isDismissable
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <Modal className="max-w-2xl">
                <Dialog
                    aria-label="Edit color scheme"
                    className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
                    style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                >
                    <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                        <h2 className="text-sm font-semibold text-primary">Edit color scheme</h2>
                        <Button size="sm" color="tertiary" iconLeading={XClose} onClick={onClose} aria-label="Close editor" />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-5">
                        {/* Name */}
                        <label className="mb-1 block text-xs font-medium text-secondary">Name</label>
                        <Input autoFocus aria-label="Scheme name" value={draft.name} onChange={(v) => set("name", v)} size="sm" className="mb-1 w-full" />
                        {nameClash && <p className="mb-2 text-xs text-error-primary">A scheme named “{nameTrim}” already exists.</p>}

                        {/* Live mini-terminal preview */}
                        <div
                            className="my-4 rounded-lg p-3 font-mono text-xs"
                            style={{ background: draft.background, color: draft.foreground, border: "1px solid var(--c-border)" }}
                        >
                            <div style={{ color: draft.green }}>$ coretex connect web-01</div>
                            <div className="mt-1" style={{ color: draft.foreground }}>
                                Connected to 10.0.1.10
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                                {ANSI_KEYS.map((k) => (
                                    <span
                                        key={k}
                                        style={{ width: 12, height: 12, background: draft[k], borderRadius: 2, border: "1px solid rgba(255,255,255,0.12)" }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Named colors */}
                        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-quaternary uppercase">Base</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {NAMED_KEYS.map((k) => (
                                <ColorField key={k} label={NAMED_LABELS[k]} value={draft[k]} onChange={(v) => set(k, v)} />
                            ))}
                        </div>
                        {/* ANSI palette */}
                        <p className="mt-4 mb-1.5 text-[11px] font-semibold tracking-wide text-quaternary uppercase">ANSI palette</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {ANSI_KEYS.map((k) => (
                                <ColorField key={k} label={k} value={draft[k]} onChange={(v) => set(k, v)} />
                            ))}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                        <Button size="sm" color="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button size="sm" color="primary" isDisabled={!valid} onClick={() => onSave({ ...draft, name: nameTrim, builtIn: false })}>
                            Save scheme
                        </Button>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};
