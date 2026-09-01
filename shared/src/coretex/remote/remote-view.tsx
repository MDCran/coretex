// @ts-nocheck
"use client";

// Coretex — Remote (SSH / SFTP / FTP). A WinSCP-style session manager with INLINE
// host CRUD (add/edit/remove right here, no Settings round-trip), backed by the
// Brain's real RemoteService (ssh2 for SSH+SFTP, basic-ftp for FTP). Left rail =
// saved hosts; main = a connect bar + dual local/remote panes with directory
// browsing and per-file transfer. Credentials are written to the vault, never echoed.

import { useEffect, useMemo, useState } from "react";
import type { CoretexConfig, RemoteEntry } from "@repo/coretex/types";
import {
    ArrowUp,
    Copy01,
    Download01,
    Edit01,
    File02,
    FilePlus02,
    FolderPlus,
    Link01,
    LinkBroken01,
    Plus,
    RefreshCcw01,
    Server01,
    Trash01,
    Upload01,
    XClose,
} from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { TextArea } from "@/components/base/textarea/textarea";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { cx } from "@/utils/cx";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { ThumbOrIcon } from "../files/files-view";
import { MetaEntryIcon } from "../files/meta-ui";
import { writeDragPayload, readDragPayload, DRAG_MIME } from "../files/drag-payload";
import { useContextMenu, type MenuItem } from "../ui/context-menu";

type SshHost = CoretexConfig["remote"]["sshHosts"][number];
type Protocol = "ssh" | "sftp" | "ftp";

const SURFACE = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;
const SURFACE2 = { background: "var(--surface-2)" } as const;

const PROTOCOLS: { label: string; value: Protocol; port: number }[] = [
    { label: "SFTP (over SSH)", value: "sftp", port: 22 },
    { label: "SSH (browse via SFTP)", value: "ssh", port: 22 },
    { label: "FTP", value: "ftp", port: 21 },
];
const AUTH_OPTIONS: { label: string; value: SshHost["auth"] }[] = [
    { label: "Password", value: "password" },
    { label: "Private key", value: "key" },
    { label: "SSH agent", value: "agent" },
];

function protocolOf(h: SshHost): Protocol {
    return (h.protocol as Protocol) ?? "sftp";
}
function protoLabel(p: Protocol): string {
    return p === "ftp" ? "FTP" : p === "ssh" ? "SSH" : "SFTP";
}
function uniqueId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function fmtSize(n: number): string {
    if (!n) return "—";
    if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + " GB";
    if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
    return `${n} B`;
}
function fmtWhen(ms?: number): string {
    if (!ms) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
/** Rename the final segment of a POSIX or local path to `newName`. */
function renamePath(path: string, newName: string): string {
    const i = Math.max(path.replace(/[\\/]+$/, "").lastIndexOf("\\"), path.replace(/[\\/]+$/, "").lastIndexOf("/"));
    if (i < 0) return newName;
    return path.replace(/[\\/]+$/, "").slice(0, i + 1) + newName;
}
function posixParent(p: string): string {
    if (!p || p === "/") return "/";
    const trimmed = p.replace(/\/+$/, "");
    const i = trimmed.lastIndexOf("/");
    return i <= 0 ? "/" : trimmed.slice(0, i);
}
function winParent(p: string): string | null {
    const trimmed = p.replace(/[\\/]+$/, "");
    const i = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
    if (i < 0) return null;
    const parent = trimmed.slice(0, i + 1);
    return parent || null;
}
/** Join a name onto a LOCAL dir using the dir's own separator (Windows "\\" vs POSIX "/"). */
function joinLocalPath(dir: string, name: string): string {
    const sep = dir.includes("\\") ? "\\" : "/";
    return dir.endsWith("\\") || dir.endsWith("/") ? dir + name : dir + sep + name;
}

interface EditorState {
    host: SshHost;
    secret: string;
    isNew: boolean;
}

interface NameDialogState {
    title: string;
    initialValue: string;
    confirmLabel: string;
    onSubmit: (name: string) => void;
}

export const RemoteView = ({ state, actions }: { state: CoretexState; actions: CoretexActions }) => {
    const remoteCfg = state.settings?.remote;
    const hosts = useMemo(() => remoteCfg?.sshHosts ?? [], [remoteCfg]);
    const [selected, setSelected] = useState<string | null>(hosts[0]?.id ?? null);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const ctx = useContextMenu();
    const hostDeletion = useConfirm();

    // Keep a valid selection as the host list changes.
    useEffect(() => {
        if (selected && !hosts.some((h) => h.id === selected)) setSelected(hosts[0]?.id ?? null);
        if (!selected && hosts[0]) setSelected(hosts[0].id);
    }, [hosts, selected]);

    const host = hosts.find((h) => h.id === selected) ?? null;
    // A reconnect can replace a failed session. Prefer the newest live record so
    // stale errors never hide the current connecting/connected attempt.
    const session = [...state.remote.sessions].reverse().find((s) => s.hostId === selected && s.status !== "closed") ?? null;
    const connected = session?.status === "connected";

    // Both panes share lifted cwd state so transfers can target the *other* pane's directory.
    const [localCwd, setLocalCwd] = useState("");
    useEffect(() => {
        if (localCwd === "" && state.fs.home) setLocalCwd(state.fs.home);
    }, [state.fs.home, localCwd]);
    const remoteCwd = session ? state.remote.listings[session.id]?.path ?? session.cwd : "/";

    const writeHosts = (next: SshHost[]): void => {
        if (!remoteCfg) return;
        actions.updateSettings({ remote: { ...remoteCfg, sshHosts: next } });
    };

    const saveEditor = (): void => {
        if (!editor) return;
        const h = editor.host;
        const exists = hosts.some((x) => x.id === h.id);
        writeHosts(exists ? hosts.map((x) => (x.id === h.id ? h : x)) : [...hosts, h]);
        if (editor.secret.trim()) actions.setSecret(`remote.${h.id}`, editor.secret);
        setSelected(h.id);
        setEditor(null);
    };

    const removeHost = (id: string): void => {
        const s = state.remote.sessions.find((x) => x.hostId === id && x.status !== "closed");
        if (s) actions.remoteDisconnect(s.id);
        // Clear the protected credential alongside the saved host so deleting a
        // connection never leaves an orphaned password/private key behind.
        actions.setSecret(`remote.${id}`, "");
        writeHosts(hosts.filter((h) => h.id !== id));
    };

    const requestRemoveHost = (entry: SshHost): void => {
        hostDeletion.confirm({
            title: `Remove ${entry.label || entry.host || "this host"}?`,
            description: "This removes the saved connection and disconnects its active session. Files on the remote host are not changed.",
            confirmLabel: "Remove host",
            onConfirm: () => removeHost(entry.id),
        });
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4 sm:p-6">
            <div className="flex items-center gap-3">
                <h1 className="text-display-xs font-semibold text-primary">Remote</h1>
                <Badge color="gray" size="sm">SSH · SFTP · FTP</Badge>
                <Button
                    size="sm"
                    color="secondary"
                    iconLeading={Plus}
                    className="ml-auto"
                    onClick={() =>
                        setEditor({
                            host: { id: uniqueId("host"), label: "", protocol: "sftp", host: "", port: 22, user: "", auth: "password" },
                            secret: "",
                            isNew: true,
                        })
                    }
                >
                    Add host
                </Button>
            </div>
            <p className="mt-1 text-sm text-tertiary">
                Add, edit, and connect hosts right here. Credentials are stored in the local vault and never displayed again.
            </p>

            <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
                {/* ---- Host rail ---- */}
                <div className="flex max-h-56 min-h-0 flex-col overflow-y-auto rounded-xl p-2 xl:max-h-none" style={SURFACE}>
                    {hosts.length === 0 ? (
                        <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
                            <Server01 className="size-5 text-quaternary" />
                            <p className="text-sm font-medium text-secondary">No saved hosts</p>
                            <p className="text-xs text-tertiary">Click “Add host” to save a connection.</p>
                        </div>
                    ) : (
                        hosts.map((h) => {
                            const active = selected === h.id;
                            const proto = protocolOf(h);
                            const live = state.remote.sessions.find((s) => s.hostId === h.id && s.status !== "closed");
                            return (
                                <div
                                    key={h.id}
                                    className={cx("group flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition", active ? "" : "hover:bg-secondary")}
                                    style={active ? { background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-fg)" } : { color: "var(--c-text-secondary)" }}
                                >
                                    <button type="button" onClick={() => setSelected(h.id)} className="flex min-w-0 flex-1 items-center gap-2">
                                        <Server01 className="size-4 shrink-0" />
                                        <span className="min-w-0">
                                            <span className="flex items-center gap-1.5">
                                                <span className="block truncate text-sm font-medium">{h.label || h.host || "Untitled host"}</span>
                                                {live?.status === "connected" && <span className="size-1.5 shrink-0 rounded-full" style={{ background: "#22c55e" }} title="Connected" />}
                                            </span>
                                            <span className="block truncate text-xs text-quaternary">
                                                {protoLabel(proto)} · {h.user ? `${h.user}@` : ""}{h.host || "?"}:{h.port}
                                            </span>
                                        </span>
                                    </button>
                                    <span className="flex shrink-0 items-center gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                        <button type="button" title="Edit" onClick={() => setEditor({ host: { ...h }, secret: "", isNew: false })} className="rounded p-1 hover:bg-[var(--surface-2)]">
                                            <Edit01 className="size-3.5 text-quaternary" />
                                        </button>
                                        <button type="button" title="Delete" onClick={() => requestRemoveHost(h)} className="rounded p-1 hover:bg-[var(--surface-2)]">
                                            <Trash01 className="size-3.5 text-error-primary" />
                                        </button>
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* ---- Transfer area ---- */}
                <div className="flex min-h-0 flex-col rounded-xl" style={SURFACE}>
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:gap-3" style={{ borderBottom: "1px solid var(--c-border)" }}>
                        {host ? (
                            <>
                                <span className="truncate text-sm font-medium text-primary">{host.label || host.host}</span>
                                <Badge color="gray" size="sm">{protoLabel(protocolOf(host))}</Badge>
                                {session?.status === "error" && <Badge color="error" size="sm">{session.error?.slice(0, 60) || "Error"}</Badge>}
                                {session?.status === "connecting" && <Badge color="warning" size="sm">Connecting…</Badge>}
                                {connected && <Badge color="success" size="sm" type="pill-color">Connected</Badge>}
                                {connected && <span className="hidden text-xs text-quaternary lg:inline">Drag files between panes to upload / download</span>}
                                {connected ? (
                                    <Button size="sm" color="secondary" iconLeading={LinkBroken01} className="ml-auto" onClick={() => session && actions.remoteDisconnect(session.id)}>
                                        Disconnect
                                    </Button>
                                ) : (
                                    <Button size="sm" color="primary" iconLeading={Link01} className="ml-auto" isLoading={session?.status === "connecting"} onClick={() => actions.remoteConnect(host.id)}>
                                        Connect
                                    </Button>
                                )}
                            </>
                        ) : (
                            <span className="text-sm text-tertiary">Select or add a host</span>
                        )}
                    </div>

                    <div className="grid min-h-[520px] flex-1 grid-cols-1 grid-rows-2 lg:min-h-0 lg:grid-cols-2 lg:grid-rows-1">
                        <LocalPane state={state} actions={actions} cwd={localCwd} setCwd={setLocalCwd} sessionId={connected ? session?.id ?? null : null} remoteCwd={remoteCwd} openMenu={ctx.open} />
                        <RemotePane state={state} actions={actions} sessionId={session?.id ?? null} connected={connected} localCwd={localCwd} openMenu={ctx.open} />
                    </div>
                </div>
            </div>

            {editor && <HostEditor editor={editor} setEditor={setEditor} onSave={saveEditor} />}
            {ctx.node}
            {hostDeletion.dialog}
        </div>
    );
};

// ---- Local pane (independent of the Files view; uses the fs.dirs cache) ----
const LocalPane = ({
    state,
    actions,
    cwd,
    setCwd,
    sessionId,
    remoteCwd,
    openMenu,
}: {
    state: CoretexState;
    actions: CoretexActions;
    cwd: string;
    setCwd: (p: string) => void;
    sessionId: string | null;
    remoteCwd: string;
    openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
}) => {
    useEffect(() => {
        if (cwd) actions.fsListDir(cwd);
    }, [cwd, actions, state.remote.lastOp]);

    const [over, setOver] = useState(false);
    const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
    const deletion = useConfirm();
    const listing = cwd ? state.fs.dirs[cwd] : undefined;
    const entries = listing?.entries ?? [];
    const parent = cwd ? winParent(cwd) : null;
    const joinRemote = (name: string): string => (remoteCwd.endsWith("/") ? remoteCwd + name : `${remoteCwd}/${name}`);
    const joinLocal = (name: string): string => joinLocalPath(cwd, name);

    const refresh = (): void => { if (cwd) actions.fsListDir(cwd); };
    const upload = (e: { path: string; name: string }): void => { if (sessionId) actions.remoteUpload(sessionId, e.path, joinRemote(e.name)); };
    const renameLocal = (e: { path: string; name: string }): void => {
        setNameDialog({
            title: `Rename ${e.name}`,
            initialValue: e.name,
            confirmLabel: "Rename",
            onSubmit: (next) => {
                if (next !== e.name) actions.fsMove(e.path, renamePath(e.path, next));
            },
        });
    };
    const deleteLocal = (e: { path: string; name: string; isDir: boolean }): void => {
        deletion.confirm({
            title: `Delete ${e.name}?`,
            description: e.isDir
                ? "This permanently deletes the folder and everything inside it from this computer."
                : "This permanently deletes the file from this computer.",
            confirmLabel: e.isDir ? "Delete folder" : "Delete file",
            onConfirm: () => actions.fsDelete(e.path),
        });
    };
    const newFolder = (): void => setNameDialog({ title: "New local folder", initialValue: "New folder", confirmLabel: "Create folder", onSubmit: (name) => actions.fsMkdir(joinLocal(name)) });
    const newFile = (): void => setNameDialog({ title: "New local file", initialValue: "untitled.txt", confirmLabel: "Create file", onSubmit: (name) => actions.fsNewFile(joinLocal(name)) });
    const copyPath = (p: string): void => { try { navigator.clipboard?.writeText(p); } catch { /* ignore */ } };

    const rowMenu = (e: { path: string; name: string; isDir: boolean }): MenuItem[] => [
        ...(e.isDir ? [{ key: "open", label: "Open", icon: FolderPlus, onClick: () => setCwd(e.path) } as MenuItem] : []),
        ...(!e.isDir && sessionId ? [{ key: "up", label: `Upload to remote`, icon: Upload01, onClick: () => upload(e) } as MenuItem] : []),
        { key: "rename", label: "Rename…", icon: Edit01, onClick: () => renameLocal(e) },
        { key: "copy", label: "Copy path", icon: Copy01, onClick: () => copyPath(e.path) },
        { separator: true },
        { key: "newf", label: "New folder…", icon: FolderPlus, onClick: newFolder },
        { key: "newfile", label: "New file…", icon: FilePlus02, onClick: newFile },
        { key: "refresh", label: "Refresh", icon: RefreshCcw01, onClick: refresh },
        { separator: true },
        { key: "del", label: "Delete", icon: Trash01, danger: true, onClick: () => deleteLocal(e) },
    ];

    return (
        <div className="flex min-h-0 flex-col border-b p-3 lg:border-r lg:border-b-0" style={{ borderColor: "var(--c-border)" }}>
            <PaneHeader title="Local" path={cwd} onUp={parent ? () => setCwd(parent) : undefined} onRefresh={refresh} onMkdir={newFolder} onNavigate={(p) => setCwd(p)} />
            <div
                className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg"
                style={{ ...SURFACE2, outline: over ? "2px dashed var(--brand)" : undefined, outlineOffset: "-2px" }}
                onDragOver={(ev) => { if (sessionId && cwd && ev.dataTransfer.types.includes(DRAG_MIME)) { ev.preventDefault(); setOver(true); } }}
                onDragLeave={() => setOver(false)}
                onDrop={(ev) => {
                    ev.preventDefault();
                    setOver(false);
                    const p = readDragPayload(ev.dataTransfer);
                    // A remote file dropped onto the local pane → download it here.
                    if (p && p.origin === "remote" && p.sessionId && cwd) actions.remoteDownload(p.sessionId, p.path, joinLocal(p.name));
                }}
            >
                {entries.length === 0 ? (
                    <p className="p-4 text-center text-xs text-quaternary">{listing?.error ? listing.error : (sessionId ? "Empty — drag remote files here to download" : "Empty")}</p>
                ) : (
                    entries.map((e) => (
                        <Row
                            key={e.path}
                            name={e.name}
                            path={e.path}
                            isDir={e.isDir}
                            size={e.size}
                            modified={e.modified}
                            origin="local"
                            thumbs={state.fs.thumbs}
                            request={actions.fsThumbnail}
                            onOpen={e.isDir ? () => setCwd(e.path) : undefined}
                            onRename={() => renameLocal(e)}
                            onDelete={() => deleteLocal(e)}
                            onContextMenu={(ev) => openMenu(ev, rowMenu(e))}
                            action={
                                !e.isDir && sessionId
                                    ? { icon: Upload01, title: `Upload to ${remoteCwd}`, onClick: () => upload(e) }
                                    : undefined
                            }
                        />
                    ))
                )}
            </div>
            {nameDialog && <NameDialog state={nameDialog} onClose={() => setNameDialog(null)} />}
            {deletion.dialog}
        </div>
    );
};

// ---- Remote pane ----
const RemotePane = ({
    state,
    actions,
    sessionId,
    connected,
    localCwd,
    openMenu,
}: {
    state: CoretexState;
    actions: CoretexActions;
    sessionId: string | null;
    connected: boolean;
    localCwd: string;
    openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
}) => {
    const [over, setOver] = useState(false);
    const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
    const deletion = useConfirm();
    const listing = sessionId ? state.remote.listings[sessionId] : undefined;
    const cwd = listing?.path ?? "/";
    const entries: RemoteEntry[] = listing?.entries ?? [];
    const joinRemote = (name: string): string => (cwd.endsWith("/") ? cwd + name : `${cwd}/${name}`);

    const refresh = (): void => { if (connected && sessionId) actions.remoteList(sessionId, cwd); };
    const mkdir = (): void => {
        if (!connected || !sessionId) return;
        setNameDialog({
            title: "New remote folder",
            initialValue: "New folder",
            confirmLabel: "Create folder",
            onSubmit: (name) => actions.remoteMkdir(sessionId, joinRemote(name)),
        });
    };
    const download = (e: { path: string; name: string }): void => {
        if (sessionId && localCwd) actions.remoteDownload(sessionId, e.path, joinLocalPath(localCwd, e.name));
    };
    const renameRemote = (e: { path: string; name: string }): void => {
        if (!sessionId) return;
        setNameDialog({
            title: `Rename ${e.name}`,
            initialValue: e.name,
            confirmLabel: "Rename",
            onSubmit: (next) => {
                if (next !== e.name) actions.remoteRename(sessionId, e.path, renamePath(e.path, next));
            },
        });
    };
    const deleteRemote = (e: { path: string; name: string; isDir: boolean }): void => {
        if (!sessionId) return;
        deletion.confirm({
            title: `Delete ${e.name} from the remote host?`,
            description: e.isDir
                ? "This permanently deletes the remote folder. Only empty folders can be removed."
                : "This permanently deletes the remote file and cannot be undone from Coretex.",
            confirmLabel: e.isDir ? "Delete folder" : "Delete file",
            onConfirm: () => actions.remoteDelete(sessionId, e.path, e.isDir),
        });
    };
    const copyPath = (p: string): void => { try { navigator.clipboard?.writeText(p); } catch { /* ignore */ } };

    const rowMenu = (e: { path: string; name: string; isDir: boolean }): MenuItem[] => {
        if (!sessionId) return [];
        return [
            ...(e.isDir ? [{ key: "open", label: "Open", icon: FolderPlus, onClick: () => actions.remoteList(sessionId, e.path) } as MenuItem] : []),
            ...(!e.isDir && localCwd ? [{ key: "dl", label: "Download", icon: Download01, onClick: () => download(e) } as MenuItem] : []),
            { key: "rename", label: "Rename…", icon: Edit01, onClick: () => renameRemote(e) },
            { key: "copy", label: "Copy path", icon: Copy01, onClick: () => copyPath(e.path) },
            { separator: true },
            { key: "mkdir", label: "New folder…", icon: FolderPlus, onClick: mkdir },
            { key: "refresh", label: "Refresh", icon: RefreshCcw01, onClick: refresh },
            { separator: true },
            { key: "del", label: "Delete", icon: Trash01, danger: true, onClick: () => deleteRemote(e) },
        ];
    };

    return (
        <div className="flex min-h-0 flex-col p-3">
            <PaneHeader
                title="Remote"
                path={connected ? cwd : ""}
                onUp={connected && sessionId && cwd !== "/" ? () => actions.remoteList(sessionId, posixParent(cwd)) : undefined}
                onRefresh={connected && sessionId ? refresh : undefined}
                onMkdir={connected && sessionId ? mkdir : undefined}
                onNavigate={connected && sessionId ? (p) => actions.remoteList(sessionId, p) : undefined}
            />
            <div
                className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg"
                style={{ ...SURFACE2, outline: over ? "2px dashed var(--brand)" : undefined, outlineOffset: "-2px" }}
                onDragOver={(ev) => { if (connected && sessionId && ev.dataTransfer.types.includes(DRAG_MIME)) { ev.preventDefault(); setOver(true); } }}
                onDragLeave={() => setOver(false)}
                onDrop={(ev) => {
                    ev.preventDefault();
                    setOver(false);
                    const p = readDragPayload(ev.dataTransfer);
                    // A local file dropped onto the remote pane → upload it to the current remote dir.
                    if (p && p.origin === "local" && sessionId) actions.remoteUpload(sessionId, p.path, joinRemote(p.name));
                }}
            >
                {!connected ? (
                    <p className="p-4 text-center text-xs text-quaternary">Connect to browse remote files.</p>
                ) : listing?.error ? (
                    <p className="p-4 text-center text-xs text-error-primary">{listing.error}</p>
                ) : entries.length === 0 ? (
                    <p className="p-4 text-center text-xs text-quaternary">Empty directory — drag local files here to upload</p>
                ) : (
                    entries.map((e) => (
                        <Row
                            key={e.path}
                            name={e.name}
                            path={e.path}
                            isDir={e.isDir}
                            size={e.size}
                            modified={e.modified}
                            origin="remote"
                            sessionId={sessionId ?? undefined}
                            onOpen={e.isDir && sessionId ? () => actions.remoteList(sessionId, e.path) : undefined}
                            onRename={() => renameRemote(e)}
                            onDelete={() => deleteRemote(e)}
                            onContextMenu={(ev) => openMenu(ev, rowMenu(e))}
                            action={
                                !e.isDir && sessionId && localCwd
                                    ? {
                                          icon: Download01,
                                          title: `Download to ${localCwd}`,
                                          onClick: () => download(e),
                                      }
                                    : undefined
                            }
                        />
                    ))
                )}
            </div>
            {state.remote.lastOp && !state.remote.lastOp.ok && (
                <p className="mt-1 truncate text-xs text-error-primary" title={state.remote.lastOp.error}>
                    {state.remote.lastOp.op} failed: {state.remote.lastOp.error}
                </p>
            )}
            {nameDialog && <NameDialog state={nameDialog} onClose={() => setNameDialog(null)} />}
            {deletion.dialog}
        </div>
    );
};

const PaneHeader = ({
    title,
    path,
    onUp,
    onRefresh,
    onMkdir,
    onNavigate,
}: {
    title: string;
    path: string;
    onUp?: () => void;
    onRefresh?: () => void;
    onMkdir?: () => void;
    /** When set, the path becomes an editable address bar (WinSCP-style) — Enter jumps there. */
    onNavigate?: (path: string) => void;
}) => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(path);
    useEffect(() => { if (!editing) setValue(path); }, [path, editing]);
    const commit = (): void => {
        setEditing(false);
        const p = value.trim();
        if (p && p !== path) onNavigate?.(p);
    };
    return (
        <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-quaternary">{title}</span>
            {editing && onNavigate ? (
                <input
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") { setEditing(false); setValue(path); } }}
                    className="min-w-0 flex-1 rounded bg-transparent px-1.5 py-0.5 font-mono text-xs outline-none"
                    style={{ color: "var(--c-text-primary)", border: "1px solid var(--brand)" }}
                    aria-label={`${title} path`}
                />
            ) : (
                <button
                    type="button"
                    title={onNavigate ? `${path || "—"} — click to edit path` : path}
                    onClick={() => onNavigate && setEditing(true)}
                    disabled={!onNavigate}
                    className={cx("min-w-0 flex-1 truncate text-left text-xs text-tertiary", onNavigate && "rounded px-1 hover:bg-[var(--surface)] hover:text-secondary")}
                >
                    {path || "—"}
                </button>
            )}
            {onMkdir && (
                <button type="button" title="New folder" onClick={onMkdir} className="rounded p-1 text-quaternary hover:bg-[var(--surface-2)]">
                    <FolderPlus className="size-3.5" />
                </button>
            )}
            {onUp && (
                <button type="button" title="Up" onClick={onUp} className="rounded p-1 text-quaternary hover:bg-[var(--surface-2)]">
                    <ArrowUp className="size-3.5" />
                </button>
            )}
            {onRefresh && (
                <button type="button" title="Refresh" onClick={onRefresh} className="rounded p-1 text-quaternary hover:bg-[var(--surface-2)]">
                    <RefreshCcw01 className="size-3.5" />
                </button>
            )}
        </div>
    );
};

// Shared row — identical Files styling on both panes; files are draggable for transfer.
const Row = ({
    name,
    path,
    isDir,
    size,
    modified,
    origin,
    sessionId,
    onOpen,
    action,
    onRename,
    onDelete,
    onContextMenu,
    thumbs,
    request,
}: {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modified?: number;
    origin: "local" | "remote";
    sessionId?: string;
    onOpen?: () => void;
    action?: { icon: typeof File02; title: string; onClick: () => void };
    onRename?: () => void;
    onDelete?: () => void;
    onContextMenu?: (ev: React.MouseEvent) => void;
    /** Local rows get live thumbnails; remote rows fall back to the type icon. */
    thumbs?: Record<string, string | null>;
    request?: (p: string) => void;
}) => (
    <div
        className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--surface)]"
        draggable={!isDir}
        onDragStart={!isDir ? (ev) => { ev.dataTransfer.effectAllowed = "copy"; writeDragPayload(ev.dataTransfer, { path, name, isDir, origin, ...(sessionId ? { sessionId } : {}) }); } : undefined}
        onContextMenu={onContextMenu}
        onDoubleClick={onOpen}
    >
        <button type="button" onClick={onOpen} disabled={!onOpen} className={cx("flex min-w-0 flex-1 items-center gap-2 text-left", onOpen ? "cursor-pointer" : "cursor-default")}>
            {thumbs && request ? (
                <ThumbOrIcon path={path} name={name} isDir={isDir} px={18} thumbs={thumbs} request={request} />
            ) : (
                <MetaEntryIcon name={name} isDir={isDir} px={18} />
            )}
            <span className="min-w-0 flex-1 truncate text-sm text-primary">{name}</span>
            {!!modified && <span className="hidden shrink-0 text-xs text-quaternary tabular-nums xl:inline">{fmtWhen(modified)}</span>}
            {!isDir && <span className="w-16 shrink-0 text-right text-xs text-quaternary tabular-nums">{fmtSize(size)}</span>}
        </button>
        <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
            {action && (
                <button type="button" title={action.title} onClick={action.onClick} className="rounded p-1 text-quaternary transition hover:bg-[var(--surface-2)] hover:text-brand-secondary">
                    <action.icon className="size-3.5" />
                </button>
            )}
            {onRename && (
                <button type="button" title="Rename (F2)" onClick={onRename} className="rounded p-1 text-quaternary transition hover:bg-[var(--surface-2)] hover:text-primary">
                    <Edit01 className="size-3.5" />
                </button>
            )}
            {onDelete && (
                <button type="button" title="Delete" onClick={onDelete} className="rounded p-1 text-quaternary transition hover:bg-[var(--surface-2)] hover:text-error-primary">
                    <Trash01 className="size-3.5" />
                </button>
            )}
        </div>
    </div>
);

/** Accessible in-app replacement for browser prompt() used by file operations. */
const NameDialog = ({ state, onClose }: { state: NameDialogState; onClose: () => void }) => {
    const [value, setValue] = useState(state.initialValue);
    const name = value.trim();
    const valid = Boolean(name) && name !== "." && name !== ".." && !/[\\/\0]/.test(name);
    const submit = (): void => {
        if (!valid) return;
        state.onSubmit(name);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div role="dialog" aria-modal="true" aria-label={state.title} className="w-full max-w-sm rounded-2xl p-5 shadow-xl" style={SURFACE} onMouseDown={(event) => event.stopPropagation()}>
                <h2 className="text-md font-semibold text-primary">{state.title}</h2>
                <div className="mt-4">
                    <Input
                        autoFocus
                        value={value}
                        onChange={setValue}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") submit();
                            else if (event.key === "Escape") onClose();
                        }}
                        isInvalid={Boolean(name) && !valid}
                        hint={!valid && name ? "Use a single file or folder name without slashes." : undefined}
                    />
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" isDisabled={!valid} onClick={submit}>{state.confirmLabel}</Button>
                </div>
            </div>
        </div>
    );
};

// ---- Host editor modal ----
const HostEditor = ({ editor, setEditor, onSave }: { editor: EditorState; setEditor: (e: EditorState | null) => void; onSave: () => void }) => {
    const h = editor.host;
    const patch = (p: Partial<SshHost>): void => setEditor({ ...editor, host: { ...editor.host, ...p } });
    const proto = (h.protocol as Protocol) ?? "sftp";
    const valid = h.host.trim() !== "" && h.port > 0 && (proto === "ftp" || h.user.trim() !== "" || h.auth === "agent");

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={() => setEditor(null)}>
            <div className="w-full max-w-lg rounded-2xl p-5 shadow-xl" style={SURFACE} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                    <Server01 className="size-5 text-brand-secondary" />
                    <h2 className="text-sm font-semibold text-primary">{editor.isNew ? "Add host" : "Edit host"}</h2>
                    <button type="button" onClick={() => setEditor(null)} className="ml-auto rounded p-1 text-quaternary hover:bg-[var(--surface-2)]">
                        <XClose className="size-4" />
                    </button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className="text-xs font-medium text-secondary">Label</span>
                        <Input value={h.label} placeholder="Production box" onChange={(v: string) => patch({ label: v })} />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-secondary">Protocol</span>
                        <NativeSelect
                            options={PROTOCOLS.map((p) => ({ label: p.label, value: p.value }))}
                            value={proto}
                            onChange={(e) => {
                                const v = e.target.value as Protocol;
                                const def = PROTOCOLS.find((p) => p.value === v)?.port ?? 22;
                                patch({ protocol: v, port: def });
                            }}
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-secondary">Port</span>
                        <Input
                            type="number"
                            value={String(h.port)}
                            onChange={(v: string) => {
                                const n = Number(v);
                                patch({ port: v === "" || Number.isNaN(n) ? 0 : Math.max(0, Math.min(65535, Math.trunc(n))) });
                            }}
                        />
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className="text-xs font-medium text-secondary">Host</span>
                        <Input value={h.host} placeholder="example.com or 10.0.0.5" onChange={(v: string) => patch({ host: v })} />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-secondary">User</span>
                        <Input value={h.user} placeholder={proto === "ftp" ? "anonymous" : "root"} onChange={(v: string) => patch({ user: v })} />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-secondary">Authentication</span>
                        <NativeSelect options={AUTH_OPTIONS} value={h.auth} onChange={(e) => patch({ auth: e.target.value as SshHost["auth"] })} />
                    </label>
                    {h.auth !== "agent" && (
                        <label className="flex flex-col gap-1 sm:col-span-2">
                            <span className="text-xs font-medium text-secondary">{h.auth === "key" ? "Private key" : "Password"}</span>
                            {h.auth === "key" ? (
                                <TextArea
                                    value={editor.secret}
                                    placeholder={editor.isNew ? "Paste private key (PEM)…" : "Leave blank to keep stored key"}
                                    onChange={(v) => setEditor({ ...editor, secret: v })}
                                    rows={4}
                                    textAreaClassName="font-mono text-xs"
                                />
                            ) : (
                                <Input
                                    type="password"
                                    value={editor.secret}
                                    placeholder={editor.isNew ? "••••••••" : "Leave blank to keep stored password"}
                                    onChange={(v: string) => setEditor({ ...editor, secret: v })}
                                />
                            )}
                            <span className="text-xs text-quaternary">Stored in the local vault — never shown again.</span>
                        </label>
                    )}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={() => setEditor(null)}>Cancel</Button>
                    <Button size="sm" color="primary" isDisabled={!valid} onClick={onSave}>{editor.isNew ? "Add host" : "Save"}</Button>
                </div>
            </div>
        </div>
    );
};
