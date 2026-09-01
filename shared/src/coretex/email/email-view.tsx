// @ts-nocheck
"use client";

// Coretex — Email module. A Gmail-style 3-panel client (folders/categories ·
// list · reader) with a working AI categorizer (routes mail through the LLM hub
// against user categories) and a compose window. App-password IMAP/SMTP accounts
// sync for real; until one is connected, realistic seed mail keeps the UI usable.

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Edit05,
  Inbox01,
  Plus,
  RefreshCcw05,
  Send01,
  Star01,
  Stars01,
  Trash01,
  X,
} from "@untitledui/icons";
import type {
  EmailCategory,
  EmailFolder,
  EmailMessage,
  EmailState,
} from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { NativeSelect } from "@/components/base/select/select-native";
import { TextArea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";
import type { CoretexActions, CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { ProjectIcon } from "../ui/project-icon";
import { PageSkeleton } from "../ui/skeleton";
import { EmailSettingsPage } from "../settings/pages/email-settings-page";
import { ConnectMailboxModal } from "./connect-mailbox-modal";

/** A category's glyph: its Untitled UI icon when set, else its emoji. */
const CatIcon = ({
  category,
  size = 16,
}: {
  category: EmailCategory;
  size?: number;
}) =>
  category.icon ? (
    <ProjectIcon
      icon={category.icon}
      color={category.color}
      size={size}
      tile={false}
    />
  ) : (
    <span className="text-sm">{category.emoji || "🏷️"}</span>
  );

/** Color-coordinated, icon-bearing category picker (Untitled UI Select popover).
 * Each option shows the category's glyph and its color; "Uncategorized" is a
 * neutral dot. Used in the reader to correct/teach the AI sorter. */
const CategorySelect = ({
  value,
  categories,
  onChange,
}: {
  value: string;
  categories: EmailCategory[];
  onChange: (id: string) => void;
}) => {
  const items = [
    {
      id: "",
      label: "Uncategorized",
      color: "var(--c-text-quaternary)",
      icon: (
        <span data-icon className="inline-flex size-4 items-center justify-center">
          <span className="size-2 rounded-full" style={{ background: "var(--c-text-quaternary)" }} />
        </span>
      ),
    },
    ...categories.map((c) => ({
      id: c.id,
      label: c.name,
      color: c.color,
      icon: (
        <span data-icon className="inline-flex size-4 items-center justify-center">
          <CatIcon category={c} size={14} />
        </span>
      ),
    })),
  ];
  return (
    <Select
      size="sm"
      selectedKey={value || ""}
      onSelectionChange={(k) => onChange(k ? String(k) : "")}
      items={items}
      aria-label="Category"
      className="min-w-44"
    >
      {(item) => (
        <Select.Item id={item.id} icon={item.icon}>
          {item.label}
        </Select.Item>
      )}
    </Select>
  );
};

const FOLDERS: { id: EmailFolder; label: string; icon: typeof Inbox01 }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox01 },
  { id: "sent", label: "Sent", icon: Send01 },
  { id: "drafts", label: "Drafts", icon: Edit05 },
  { id: "starred", label: "Starred", icon: Star01 },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "trash", label: "Trash", icon: Trash01 },
];

function relTime(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];
function senderColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++)
    h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

/**
 * Match the lightweight search grammar advertised by the inbox field. Plain
 * terms search sender, subject, and preview text; `from:` and `subject:` scope
 * a term without sending private mailbox contents anywhere.
 */
function matchesMailSearch(message: EmailMessage, rawQuery: string): boolean {
  const tokens = rawQuery
    .trim()
    .toLowerCase()
    .match(/(?:[^\s"]+|"[^"]*")+/g);
  if (!tokens?.length) return true;

  const sender = `${message.from.name} ${message.from.email}`.toLowerCase();
  const subject = message.subject.toLowerCase();
  const searchable = `${sender} ${subject} ${message.snippet} ${message.bodyText}`.toLowerCase();
  const valueOf = (token: string) => token.replace(/^"|"$/g, "").trim();

  return tokens.every((token) => {
    if (token.startsWith("from:")) {
      const value = valueOf(token.slice("from:".length));
      return !value || sender.includes(value);
    }
    if (token.startsWith("subject:")) {
      const value = valueOf(token.slice("subject:".length));
      return !value || subject.includes(value);
    }
    return searchable.includes(valueOf(token));
  });
}

export const EmailView = ({
  state,
  actions,
  onNavigate,
}: {
  state: CoretexState;
  actions: CoretexActions;
  onNavigate?: (t: NavTarget) => void;
}) => {
  const email = state.email;
  const [folder, setFolder] = useState<EmailFolder>("inbox");
  const [category, setCategory] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "unread" | "starred">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeReplyTo, setComposeReplyTo] = useState<EmailMessage | null>(null);
  const [showAgent, setShowAgent] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  const realAccounts = (state.email?.accounts ?? []).filter((a) => a.kind === "imap");
  // The active mailbox drives filtering, sync, and the From address for Compose.
  const realAccount = realAccounts.find((a) => a.id === activeAccountId) ?? realAccounts[0];
  const isDemo = !realAccount;
  const beginCompose = (replyTo: EmailMessage | null = null) => {
    if (isDemo) {
      setConnectOpen(true);
      return;
    }
    setComposeReplyTo(replyTo);
    setComposeOpen(true);
  };

  useEffect(() => {
    actions.emailGet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (realAccounts.length && !realAccounts.some((a) => a.id === activeAccountId)) {
      setActiveAccountId(realAccounts[0].id);
    }
  }, [activeAccountId, realAccounts]);

  const categories = email?.categories ?? [];
  const catById = (id: string | null): EmailCategory | undefined =>
    id ? categories.find((c) => c.id === id) : undefined;

  const messages = useMemo(() => {
    const all = email?.messages ?? [];
    return all.filter((m) => {
      if (realAccount && m.accountId !== realAccount.id) return false;
      const inFolder = folder === "starred" ? m.isStarred : m.folder === folder;
      if (!inFolder) return false;
      if (category && m.aiCategory !== category) return false;
      if (tab === "unread" && m.isRead) return false;
      if (tab === "starred" && !m.isStarred) return false;
      return matchesMailSearch(m, query);
    });
  }, [email, folder, category, tab, query, realAccount]);

  // Folder, account, and filter changes must not leave an unrelated message in
  // the reader after it has disappeared from the visible list.
  useEffect(() => {
    if (selectedId && !messages.some((message) => message.id === selectedId)) {
      setSelectedId(null);
    }
  }, [messages, selectedId]);

  const selected =
    (email?.messages ?? []).find((m) => m.id === selectedId) ?? null;
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of email?.messages ?? []) {
      if (realAccount && m.accountId !== realAccount.id) continue;
      if (m.folder === "inbox" && m.aiCategory)
        map[m.aiCategory] = (map[m.aiCategory] ?? 0) + 1;
    }
    return map;
  }, [email, realAccount]);
  const unreadCount = (email?.messages ?? []).filter(
    (m) => (!realAccount || m.accountId === realAccount.id) && m.folder === "inbox" && !m.isRead,
  ).length;

  const open = (m: EmailMessage) => {
    setSelectedId(m.id);
    if (!m.isRead) actions.emailSetFlags(m.id, { isRead: true });
  };

  if (!email) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tertiary">
        Loading mailbox…
      </div>
    );
  }

  return (
    <div
      className="flex h-full overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--c-border)" }}
    >
      {/* LEFT — folders + categories */}
      <aside
        className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto p-3 xl:flex"
        style={{
          background: "var(--sidebar-bg)",
          borderRight: "1px solid var(--c-border)",
        }}
      >
        <Button
          size="md"
          color="primary"
          iconLeading={Edit05}
          className="mb-2"
          onClick={() => beginCompose()}
        >
          Compose
        </Button>

        {FOLDERS.map((f) => {
          const Icon = f.icon;
          const active = folder === f.id && !category;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFolder(f.id);
                setCategory(null);
              }}
              className={cx(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition",
                active ? "font-medium" : "hover:bg-[var(--surface-2)]",
              )}
              style={{
                background: active ? "var(--sidebar-active-bg)" : undefined,
                color: active
                  ? "var(--sidebar-active-fg)"
                  : "var(--c-text-secondary)",
              }}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{f.label}</span>
              {f.id === "inbox" && unreadCount > 0 && (
                <span className="text-xs text-quaternary">{unreadCount}</span>
              )}
            </button>
          );
        })}

        <div className="mt-3 flex items-center justify-between px-2 pb-1">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--c-text-muted)" }}
          >
            Categories
          </p>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate({ kind: "settings", page: "email" })}
              className="text-[11px] text-brand-secondary hover:underline"
            >
              Manage
            </button>
          )}
        </div>
        {categories.map((c) => {
          const active = category === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setFolder("inbox");
                setCategory(active ? null : c.id);
              }}
              className={cx(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition",
                active ? "" : "hover:bg-[var(--surface-2)]",
              )}
              style={{
                background: active ? "var(--surface-2)" : undefined,
                color: "var(--c-text-secondary)",
              }}
            >
              <CatIcon category={c} />
              <span
                className="flex-1 text-left"
                style={{ color: active ? c.color : undefined }}
              >
                {c.name}
              </span>
              {counts[c.id] > 0 && (
                <span className="text-xs text-quaternary">{counts[c.id]}</span>
              )}
            </button>
          );
        })}

        <div className="mt-auto pt-3">
          <button
            type="button"
            onClick={() => setShowAgent((v) => !v)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition hover:bg-[var(--surface-2)]"
            style={{
              background: showAgent ? "var(--surface-2)" : undefined,
              color: "var(--c-text-secondary)",
            }}
          >
            <Stars01 className="size-4" /> Email Settings
          </button>
        </div>
      </aside>

      {showAgent ? (
        <EmailSettingsFull
          state={state}
          actions={actions}
          onClose={() => setShowAgent(false)}
        />
      ) : (
        <>
          {/* CENTER — list */}
          <div
            className="flex min-w-[320px] w-[min(420px,45%)] shrink-0 flex-col"
            style={{
              background: "var(--app-bg)",
              borderRight: "1px solid var(--c-border)",
            }}
          >
            <div className="flex items-center gap-2 border-b border-secondary p-2 xl:hidden">
              <Button
                size="sm"
                color="primary"
                iconLeading={Edit05}
                onClick={() => beginCompose()}
                aria-label="Compose email"
              />
              <NativeSelect
                size="sm"
                aria-label="Mail folder"
                selectClassName="min-w-28 py-1 text-xs"
                options={FOLDERS.map((item) => ({ value: item.id, label: item.label }))}
                value={folder}
                onChange={(event) => {
                  setFolder(event.target.value as EmailFolder);
                  setCategory(null);
                }}
              />
              <NativeSelect
                size="sm"
                aria-label="Mail category"
                selectClassName="min-w-0 flex-1 py-1 text-xs"
                options={[{ value: "", label: "All categories" }, ...categories.map((item) => ({ value: item.id, label: item.name }))]}
                value={category ?? ""}
                onChange={(event) => {
                  setFolder("inbox");
                  setCategory(event.target.value || null);
                }}
              />
              <Button size="sm" color="tertiary" iconLeading={Stars01} onClick={() => setShowAgent(true)} aria-label="Email settings" />
            </div>
            {/* Account bar — connect a real mailbox, or show sync status of the connected one. */}
            {isDemo ? (
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{
                  background:
                    "color-mix(in srgb, var(--brand) 8%, var(--surface))",
                  borderBottom: "1px solid var(--c-border)",
                }}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background:
                      "color-mix(in srgb, var(--brand) 18%, transparent)",
                  }}
                >
                  <Stars01 className="size-3.5 text-brand-secondary" />
                </span>
                <p className="min-w-0 flex-1 truncate text-xs text-tertiary">
                  You're viewing{" "}
                  <span className="font-medium text-secondary">demo mail</span>.
                  Connect a real inbox to sync your own.
                </p>
                <Button
                  size="sm"
                  color="primary"
                  iconLeading={Plus}
                  onClick={() => setConnectOpen(true)}
                >
                  Connect mailbox
                </Button>
              </div>
            ) : (
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{ borderBottom: "1px solid var(--c-border)" }}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    background: realAccount!.lastError
                      ? "var(--c-error, #ef4444)"
                      : "var(--c-success, #22c55e)",
                  }}
                />
                <div className="min-w-0 flex-1">
                  {realAccounts.length > 1 ? (
                    <NativeSelect
                      size="sm"
                      aria-label="Active mailbox"
                      selectClassName="py-1 text-xs"
                      options={realAccounts.map((account) => ({ value: account.id, label: account.email }))}
                      value={realAccount!.id}
                      onChange={(event) => {
                        setActiveAccountId(event.target.value);
                        setSelectedId(null);
                      }}
                    />
                  ) : (
                    <p className="truncate text-xs font-medium text-secondary">{realAccount!.email}</p>
                  )}
                  <p className="truncate text-[11px] text-quaternary">
                    {realAccount!.syncing
                      ? "Syncing…"
                      : realAccount!.lastError
                        ? realAccount!.lastError
                        : realAccount!.lastSync
                          ? `Synced ${relTime(realAccount!.lastSync)} ago`
                          : "Connected"}
                  </p>
                </div>
                <Button
                  size="sm"
                  color="tertiary"
                  iconLeading={Plus}
                  onClick={() => setConnectOpen(true)}
                  aria-label="Add another mailbox"
                />
              </div>
            )}
            <div
              className="flex flex-col gap-2 p-3"
              style={{ borderBottom: "1px solid var(--c-border)" }}
            >
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    value={query}
                    onChange={setQuery}
                    placeholder="Search mail (from:, subject:…)"
                    size="sm"
                  />
                </div>
                <Button
                  size="sm"
                  color="secondary"
                  iconLeading={RefreshCcw05}
                  isLoading={realAccount?.syncing}
                  onClick={() =>
                    realAccount
                      ? actions.emailSyncAccount(realAccount.id)
                      : actions.emailGet()
                  }
                  aria-label={realAccount ? "Sync inbox" : "Refresh"}
                />
              </div>
              <div className="flex items-center gap-1">
                {(["all", "unread", "starred"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cx(
                      "rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition",
                      tab === t
                        ? ""
                        : "text-tertiary hover:bg-[var(--surface-2)]",
                    )}
                    style={
                      tab === t
                        ? { background: "var(--brand)", color: "#fff" }
                        : undefined
                    }
                  >
                    {t}
                  </button>
                ))}
                {email.sorting && (
                  <span className="ml-auto text-xs text-brand-secondary">
                    Sorting… {email.sortProgress?.done}/
                    {email.sortProgress?.total}
                  </span>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {messages.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-tertiary">
                  No messages here.
                </p>
              ) : (
                <ul>
                  {messages.map((m) => {
                    const cat = catById(m.aiCategory);
                    const active = m.id === selectedId;
                    return (
                      <li key={m.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-selected={active}
                          onClick={() => open(m)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              open(m);
                            }
                          }}
                          className={cx(
                            "flex w-full items-start gap-3 px-3 py-2.5 text-left transition",
                            active ? "" : "hover:bg-[var(--surface-2)]",
                          )}
                          style={{
                            background: active ? "var(--surface)" : undefined,
                            borderBottom: "1px solid var(--c-border)",
                          }}
                        >
                          <span
                            className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                            style={{ background: senderColor(m.from.email) }}
                          >
                            {initials(m.from.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {!m.isRead && (
                                <span
                                  className="size-1.5 shrink-0 rounded-full"
                                  style={{ background: "var(--brand)" }}
                                />
                              )}
                              <span
                                className={cx(
                                  "truncate text-sm",
                                  m.isRead
                                    ? "text-secondary"
                                    : "font-semibold text-primary",
                                )}
                              >
                                {m.from.name}
                              </span>
                              <span className="ml-auto shrink-0 text-xs text-quaternary">
                                {relTime(m.timestamp)}
                              </span>
                            </div>
                            <p
                              className={cx(
                                "truncate text-sm",
                                m.isRead ? "text-tertiary" : "text-primary",
                              )}
                            >
                              {m.subject}
                            </p>
                            <p className="truncate text-xs text-quaternary">
                              {m.snippet}
                            </p>
                            {cat && (
                              <span
                                className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  background: cat.color + "22",
                                  color: cat.color,
                                }}
                              >
                                {cat.emoji} {cat.name}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              actions.emailSetFlags(m.id, {
                                isStarred: !m.isStarred,
                              });
                            }}
                            className="shrink-0 p-0.5"
                          >
                            <Star01
                              className="size-4"
                              style={{
                                color: m.isStarred
                                  ? "#f59e0b"
                                  : "var(--c-text-muted)",
                                fill: m.isStarred ? "#f59e0b" : "none",
                              }}
                            />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* RIGHT — reader */}
          <div
            className="min-w-0 flex-1 overflow-y-auto"
            style={{ background: "var(--surface)" }}
          >
            {selected ? (
              <Reader
                message={selected}
                category={catById(selected.aiCategory)}
                categories={categories}
                actions={actions}
                onReply={() => beginCompose(selected)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Inbox01 className="size-7 text-quaternary" />
                <p className="text-sm text-tertiary">
                  Select an email to read it.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {composeOpen && (
        <Compose
          actions={actions}
          emailState={email}
          accountId={realAccount?.id}
          replyTo={composeReplyTo}
          onClose={() => setComposeOpen(false)}
        />
      )}
      {connectOpen && (
        <ConnectMailboxModal
          actions={actions}
          emailState={email}
          onClose={() => setConnectOpen(false)}
        />
      )}
    </div>
  );
};

// ---- reader ----
const Reader = ({
  message: m,
  category,
  categories,
  actions,
  onReply,
}: {
  message: EmailMessage;
  category?: EmailCategory;
  categories: EmailCategory[];
  actions: CoretexActions;
  onReply: () => void;
}) => (
  <div className="flex h-full flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-secondary p-4">
      <Button size="sm" color="secondary" onClick={onReply}>
        Reply
      </Button>
      <Button
        size="sm"
        color="tertiary"
        iconLeading={Archive}
        onClick={() => actions.emailMove(m.id, { folder: "archive" })}
      >
        Archive
      </Button>
      <Button
        size="sm"
        color="tertiary"
        iconLeading={Star01}
        onClick={() => actions.emailSetFlags(m.id, { isStarred: !m.isStarred })}
      >
        {m.isStarred ? "Unstar" : "Star"}
      </Button>
      <Button
        size="sm"
        color="tertiary"
        onClick={() => actions.emailSetFlags(m.id, { isRead: false })}
      >
        Mark unread
      </Button>
      <Button
        size="sm"
        color="tertiary-destructive"
        iconLeading={Trash01}
        onClick={() => actions.emailMove(m.id, { folder: "trash" })}
      >
        Delete
      </Button>

      {/* Correct the AI's sort — picking a category teaches the sorter for next time. */}
      <div className="ml-auto flex items-center gap-1.5">
        <span className="text-xs text-quaternary">Category</span>
        <CategorySelect
          value={m.aiCategory ?? ""}
          categories={categories}
          onChange={(id) => id ? actions.emailCorrectSort(m.id, id) : actions.emailMove(m.id, { category: null })}
        />
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-lg font-semibold text-primary">{m.subject}</h1>
        {category && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ background: category.color + "22", color: category.color }}
          >
            {category.emoji} {category.name}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3 border-b border-secondary pb-4">
        <span
          className="flex size-9 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ background: senderColor(m.from.email) }}
        >
          {initials(m.from.name)}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary">
            {m.from.name}{" "}
            <span className="text-tertiary">&lt;{m.from.email}&gt;</span>
          </p>
          <p className="text-xs text-quaternary">
            to {m.to.map((t) => t.name || t.email).join(", ")} ·{" "}
            {new Date(m.timestamp).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
        {m.bodyText}
      </div>
    </div>
  </div>
);

// ---- compose ----
const Compose = ({
  actions,
  emailState,
  accountId,
  replyTo,
  onClose,
}: {
  actions: CoretexActions;
  emailState: EmailState | null;
  accountId?: string;
  replyTo: EmailMessage | null;
  onClose: () => void;
}) => {
  const [to, setTo] = useState(replyTo ? replyTo.from.email : "");
  const [subject, setSubject] = useState(
    replyTo ? `Re: ${replyTo.subject}` : "",
  );
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = requestId != null && emailState?.sending?.requestId === requestId && emailState.sending.status === "sending";

  useEffect(() => {
    const result = emailState?.sending;
    if (!requestId || !result || result.requestId !== requestId) return;
    if (result.status === "success") onClose();
    if (result.status === "error") setError(result.error || "The message could not be sent.");
  }, [emailState?.sending, onClose, requestId]);

  const send = () => {
    if (!to.trim()) return;
    setError(null);
    const id = actions.emailSend(to.trim(), subject.trim() || "(no subject)", body, accountId);
    if (!id) {
      setError("Coretex is offline. Reconnect to the Brain and try again.");
      return;
    }
    setRequestId(id);
  };

  return (
    <div
      className="fixed bottom-3 left-3 right-3 z-50 flex w-auto flex-col rounded-xl shadow-2xl sm:bottom-4 sm:left-auto sm:right-4 sm:w-[460px]"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--c-border)",
      }}
    >
      <div
        className="flex items-center justify-between rounded-t-xl px-3 py-2"
        style={{ background: "var(--sidebar-bg)" }}
      >
        <span className="text-sm font-semibold text-primary">
          {replyTo ? "Reply" : "New message"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-quaternary hover:text-secondary"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {accountId && (
          <p className="text-[11px] text-quaternary">From {emailState?.accounts.find((account) => account.id === accountId)?.email}</p>
        )}
        <Input value={to} onChange={setTo} placeholder="To" size="sm" />
        <Input
          value={subject}
          onChange={setSubject}
          placeholder="Subject"
          size="sm"
        />
        <TextArea
          value={body}
          onChange={setBody}
          rows={8}
          placeholder="Write your message…"
        />
        {error && (
          <div role="alert" className="rounded-lg px-3 py-2 text-xs text-error-primary" style={{ background: "color-mix(in srgb, var(--color-error-500, #f04438) 10%, transparent)" }}>
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" color="primary" iconLeading={Send01} isLoading={sending} isDisabled={sending || !to.trim()} onClick={send}>
            Send
          </Button>
          <Button size="sm" color="secondary" onClick={onClose}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
};

// ---- Full-width email settings (opened via the "Email Settings" button) ----
const EmailSettingsFull = ({
  state,
  actions,
  onClose,
}: {
  state: CoretexState;
  actions: CoretexActions;
  onClose: () => void;
}) => (
  <div
    className="relative flex min-w-0 flex-1 flex-col overflow-y-auto p-6"
    style={{ background: "var(--surface)" }}
  >
    <button
      type="button"
      onClick={onClose}
      className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-secondary transition hover:bg-[var(--surface-2)]"
      style={{ border: "1px solid var(--c-border)" }}
    >
      <X className="size-3.5" /> Close
    </button>
    {state.settings ? (
      <EmailSettingsPage
        settings={state.settings}
        state={state}
        actions={actions}
      />
    ) : (
      <PageSkeleton variant="settings" />
    )}
  </div>
);
