// @ts-nocheck
"use client";

// Coretex — the AI Chat page. A ChatGPT/Claude/Gemini-style conversation surface
// over the Brain's assistant:ask command (the Brain holds the keys + runs the hub;
// the renderer never talks to a provider directly).
//
//   HEADER  — a provider+model picker (reuses ui/model-picker.tsx) listing ALL chat
//             models across the user's CONNECTED providers, each with its BrandLogo,
//             model id and context/version.
//   LIST    — user bubbles (brand-tinted, right) + assistant messages (left,
//             --surface-2) rendered as lightweight markdown. <ShiningText "Thinking…"/>
//             before the first chunk and <AiLoader/> "Generating…" while streaming.
//             Inline images (markdown ![]() + sent attachments) render. Auto-scrolls.
//   COMPOSER— the Stage-2 <AiComposer/>, with the model picker in its left cluster.
//             onSend → actions.assistantAsk({ provider, model, effort, search,
//             attachments, history }); the streamed reply hydrates from
//             state.assistant[askId] and is folded into the local transcript on done.
//   EMPTY   — a centered greeting + composer, like a fresh ChatGPT screen.
//
// Multi-turn transcript lives in component state; prior turns are passed as `history`.

import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, Lightning02, Plus, Stars01, Users01 } from "@untitledui/icons";
import type { ModelInfo, ProviderType } from "@repo/coretex/types";

import { liveModels, modelAvailability, type CoretexActions, type CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { ModelPicker } from "../ui/model-picker";
import { BrandLogo } from "../ui/brand-logo";
import { AiComposer, type ComposerSendOptions, type ComposerAttachment } from "../ui/ai-composer";
import { speechOptsFor } from "../ui/speech-opts";
import { modelCaps } from "../ui/model-caps";
import { AiLoader, ShiningText } from "../ui/ai-loader";
import { cx } from "@/utils/cx";
import { RichSelect } from "@/components/base/select/rich-select";
import { Button } from "@/components/base/buttons/button";

const PROVIDER_DOMAIN: Record<string, string> = {
    ollama: "ollama.com",
    lmstudio: "lmstudio.ai",
    openai: "openai.com",
    anthropic: "anthropic.com",
    gemini: "deepmind.google",
};

const CONTEXT_AREAS = [
    { id: "email", label: "Email", color: "#f59e0b" },
    { id: "financial", label: "Financial", color: "#10b981" },
    { id: "social", label: "Social", color: "#ec4899" },
    { id: "workouts", label: "Workouts", color: "#f97316" },
    { id: "nutrition", label: "Nutrition", color: "#84cc16" },
    { id: "health", label: "Health", color: "#06b6d4" },
    { id: "todos", label: "Todos", color: "#6366f1" },
] as const;

const titleCase = (value: string): string =>
    value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

/** One transcript turn. Assistant turns carry an `askId` while streaming. */
interface ChatMsg {
    id: string;
    role: "user" | "assistant";
    /** Final/committed text. While an assistant turn streams, the live text comes from state.assistant[askId]. */
    text: string;
    /** Set on the in-flight assistant turn — keys state.assistant for the streamed reply. */
    askId?: string;
    /** Images shown on a user turn (object URLs from the composer). */
    images?: { url: string; name: string }[];
    error?: string | null;
}

// ---- a tiny, dependency-free markdown renderer ---------------------------------
// The codebase ships no markdown lib (and we must NOT add one), so we render a
// pragmatic subset: fenced code blocks, inline code, bold/italic, links, images,
// headings, bullet/numbered lists. Everything else falls through as text with
// preserved whitespace. Good enough for chat; never throws on odd input.

type Inline = { t: "text" | "code" | "bold" | "italic" | "link" | "image"; v: string; href?: string };

function parseInline(src: string): Inline[] {
    const out: Inline[] = [];
    let rest = src;
    // Order matters: image before link; code before emphasis.
    const re = /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)/;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) {
        if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
        if (m[1]) out.push({ t: "image", v: m[2] || m[3], href: m[3] });
        else if (m[4]) out.push({ t: "link", v: m[5], href: m[6] });
        else if (m[7]) out.push({ t: "code", v: m[8] });
        else if (m[9]) out.push({ t: "bold", v: m[10] });
        else if (m[11]) out.push({ t: "italic", v: m[12] });
        else if (m[13]) out.push({ t: "italic", v: m[14] });
        rest = rest.slice(m.index + m[0].length);
    }
    if (rest) out.push({ t: "text", v: rest });
    return out;
}

const InlineRun = ({ parts }: { parts: Inline[] }) => (
    <>
        {parts.map((p, i) => {
            if (p.t === "code")
                return (
                    <code key={i} className="rounded px-1 py-0.5 font-mono text-[0.85em]" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                        {p.v}
                    </code>
                );
            if (p.t === "bold") return <strong key={i} className="font-semibold">{p.v}</strong>;
            if (p.t === "italic") return <em key={i}>{p.v}</em>;
            if (p.t === "link") {
                const href = safeHref(p.href, "link");
                if (!href) return <span key={i}>{p.v}</span>;
                return (
                    <a key={i} href={href} target="_blank" rel="noreferrer" className="text-brand-secondary underline underline-offset-2 hover:opacity-80">
                        {p.v}
                    </a>
                );
            }
            if (p.t === "image") {
                const src = safeHref(p.href, "image");
                return src
                    ? <img key={i} src={src} alt={p.v} className="my-2 max-h-80 max-w-full rounded-lg" style={{ border: "1px solid var(--c-border)" }} />
                    : <span key={i}>{p.v}</span>;
            }
            return <span key={i}>{p.v}</span>;
        })}
    </>
);

/** Never let model-authored Markdown execute javascript: or load local file URLs. */
function safeHref(href: string | undefined, kind: "link" | "image"): string | undefined {
    const value = href?.trim();
    if (!value) return undefined;
    if (/^https?:\/\//i.test(value)) return value;
    if (kind === "link" && /^mailto:/i.test(value)) return value;
    if (kind === "image" && /^(blob:|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);)/i.test(value)) return value;
    return undefined;
}

function Markdown({ text }: { text: string }) {
    const blocks = useMemo(() => {
        const lines = text.split("\n");
        const nodes: React.ReactNode[] = [];
        let i = 0;
        let listBuf: { ordered: boolean; items: string[] } | null = null;

        const flushList = () => {
            if (!listBuf) return;
            const L = listBuf;
            listBuf = null;
            const Tag = L.ordered ? "ol" : "ul";
            nodes.push(
                <Tag key={`l${nodes.length}`} className={cx("my-1.5 space-y-1 pl-5", L.ordered ? "list-decimal" : "list-disc")}>
                    {L.items.map((it, k) => (
                        <li key={k}>
                            <InlineRun parts={parseInline(it)} />
                        </li>
                    ))}
                </Tag>,
            );
        };

        while (i < lines.length) {
            const line = lines[i];
            // Fenced code block.
            const fence = line.match(/^```(\w*)\s*$/);
            if (fence) {
                flushList();
                const lang = fence[1];
                const buf: string[] = [];
                i++;
                while (i < lines.length && !/^```\s*$/.test(lines[i])) {
                    buf.push(lines[i]);
                    i++;
                }
                i++; // closing fence
                nodes.push(
                    <pre key={`c${nodes.length}`} className="my-2 overflow-x-auto rounded-lg p-3 text-[0.82rem] leading-relaxed" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                        {lang && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-quaternary">{lang}</div>}
                        <code className="font-mono text-primary">{buf.join("\n")}</code>
                    </pre>,
                );
                continue;
            }
            // Headings.
            const h = line.match(/^(#{1,4})\s+(.*)$/);
            if (h) {
                flushList();
                const lvl = h[1].length;
                const sz = lvl === 1 ? "text-lg" : lvl === 2 ? "text-base" : "text-sm";
                nodes.push(
                    <p key={`h${nodes.length}`} className={cx("mt-2 mb-1 font-semibold text-primary", sz)}>
                        <InlineRun parts={parseInline(h[2])} />
                    </p>,
                );
                i++;
                continue;
            }
            // List items.
            const ul = line.match(/^\s*[-*+]\s+(.*)$/);
            const ol = line.match(/^\s*\d+\.\s+(.*)$/);
            if (ul || ol) {
                const ordered = !!ol;
                if (!listBuf || listBuf.ordered !== ordered) {
                    flushList();
                    listBuf = { ordered, items: [] };
                }
                listBuf.items.push((ul ? ul[1] : ol![1]));
                i++;
                continue;
            }
            // Blank line.
            if (line.trim() === "") {
                flushList();
                i++;
                continue;
            }
            // Paragraph (gather consecutive non-special lines).
            flushList();
            const para: string[] = [line];
            i++;
            while (i < lines.length && lines[i].trim() !== "" && !/^```/.test(lines[i]) && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s/.test(lines[i])) {
                para.push(lines[i]);
                i++;
            }
            nodes.push(
                <p key={`p${nodes.length}`} className="my-1 whitespace-pre-wrap leading-relaxed">
                    <InlineRun parts={parseInline(para.join("\n"))} />
                </p>,
            );
        }
        flushList();
        return nodes;
    }, [text]);

    return <div className="text-sm text-primary">{blocks}</div>;
}

// ---- attachments → base64 (for the multimodal/file payload) --------------------
function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}
function readAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsText(file);
    });
}

async function toPayload(atts: ComposerAttachment[]) {
    const out: { kind: "image" | "file"; name: string; mime: string; data: string; text?: string }[] = [];
    for (const a of atts) {
        const isImg = a.mime.startsWith("image/");
        try {
            if (isImg) {
                const dataUrl = await readAsDataUrl(a.file);
                out.push({ kind: "image", name: a.name, mime: a.mime, data: dataUrl.replace(/^data:[^;]+;base64,/, "") });
            } else {
                const text = await readAsText(a.file).catch(() => "");
                out.push({ kind: "file", name: a.name, mime: a.mime, data: "", text });
            }
        } catch {
            /* skip unreadable attachment */
        }
    }
    return out;
}

// --------------------------------------------------------------------------------

export const AIChatView = ({ state, actions, onNavigate }: { state: CoretexState; actions: CoretexActions; onNavigate?: (t: NavTarget) => void }) => {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [picked, setPicked] = useState<{ provider: ProviderType; id: string } | null>(null);
    const [agentId, setAgentId] = useState("");
    const [projectId, setProjectId] = useState("");
    const [contextAreas, setContextAreas] = useState<string[]>(() => CONTEXT_AREAS.map((area) => area.id));
    const [allowActions, setAllowActions] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const stoppedAskIds = useRef<Set<string>>(new Set());

    // CONNECTED providers = those reporting healthy in state.health; their model lists
    // (plus the global state.models catalog) feed the picker. Chat-capable only.
    const chatModels = useMemo<ModelInfo[]>(() => {
        return liveModels(state).filter((model) => !model.capabilities || model.capabilities.includes("chat"));
    }, [state]);

    // Default selection: first model of the first connected provider.
    useEffect(() => {
        const first = chatModels[0];
        const stillLive = picked && chatModels.some((model) => model.provider === picked.provider && model.id === picked.id);
        if (!stillLive) setPicked(first ? { provider: first.provider, id: first.id } : null);
    }, [chatModels, picked]);

    const current = picked ? chatModels.find((m) => m.provider === picked.provider && m.id === picked.id) : undefined;
    const modelState = modelAvailability(state, current?.provider, current?.id);
    const dailyLimitReached = Boolean(state.cost && state.cost.dailyLimit > 0 && state.cost.totalCostToday >= state.cost.dailyLimit);
    const availability = dailyLimitReached
        ? { available: false, reason: "The daily AI spend limit has been reached. Raise it in Usage & Analytics to continue." }
        : modelState;

    // Resolve what the selected model supports — gates the composer controls and
    // feeds the header capability hint.
    const caps = useMemo(() => modelCaps(current), [current]);
    const acceptTypes = caps.vision ? "image/*" : undefined;
    const speech = speechOptsFor(state.settings?.speech, "askAi");
    const capHints = useMemo(() => {
        const parts: string[] = [];
        if (caps.vision) parts.push("Vision");
        if (caps.tools) parts.push("Tools");
        if (caps.reasoning) parts.push("Reasoning");
        if (caps.contextLength) parts.push(`${Math.round(caps.contextLength / 1000)}k ctx`);
        return parts.join(" · ");
    }, [caps]);

    // Are we waiting on the latest assistant turn?
    const lastAssistant = messages.length ? messages[messages.length - 1] : undefined;
    const liveLast = lastAssistant?.askId ? state.assistant[lastAssistant.askId] : undefined;
    const isBusy = !!liveLast?.streaming || (!!lastAssistant?.askId && !liveLast);

    // When a stream finishes, fold the live content into the transcript so it's kept
    // for history even after state.assistant is reused.
    useEffect(() => {
        if (!lastAssistant?.askId) return;
        const live = state.assistant[lastAssistant.askId];
        if (!live) return;
        if (!live.streaming) {
            const wasStopped = stoppedAskIds.current.delete(lastAssistant.askId);
            setMessages((prev) =>
                prev.map((m) => (m.id === lastAssistant.id
                    ? { ...m, text: live.content || (live.error ? "" : wasStopped ? "Response stopped." : "No response was returned."), error: live.error, askId: undefined }
                    : m)),
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.assistant, lastAssistant?.askId, lastAssistant?.id]);

    useEffect(() => {
        if (state.connected) return;
        setMessages((previous) => previous.map((message) => message.askId && !state.assistant[message.askId]
            ? { ...message, askId: undefined, error: "Brain disconnected before the request was accepted." }
            : message));
    }, [state.connected, state.assistant]);

    // Auto-scroll to the latest content.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, liveLast?.content]);

    const send = async (text: string, opts: ComposerSendOptions) => {
        if (isBusy || !availability.available) return false;
        const stamp = Date.now();
        const imageAttachments = opts.attachments.filter((a) => a.mime.startsWith("image/"));
        const images = (await Promise.all(imageAttachments.map(async (attachment) => ({
            url: await readAsDataUrl(attachment.file).catch(() => ""),
            name: attachment.name,
        })))).filter((image) => image.url.length > 0);

        // Build history from the committed transcript (oldest first).
        const history = messages.map((m) => ({ role: m.role, content: m.askId ? (state.assistant[m.askId]?.content ?? m.text) : m.text }));

        const attachments = await toPayload(opts.attachments);

        const askId = actions.assistantAsk(text, {
            projectId: projectId || undefined,
            agentId: agentId || undefined,
            provider: picked?.provider,
            model: picked?.id,
            effort: opts.effort,
            search: opts.search,
            contextAreas,
            allowActions,
            history,
            attachments: attachments.length ? attachments : undefined,
        });
        if (!askId) return false;
        // The transcript uses durable data URLs, so temporary preview URLs can be released.
        opts.attachments.forEach((attachment) => URL.revokeObjectURL(attachment.url));

        setMessages((prev) => [
            ...prev,
            { id: `u${stamp}`, role: "user", text, images: images.length ? images : undefined },
            { id: `a${stamp}`, role: "assistant", text: "", askId },
        ]);
        return true;
    };

    const stop = () => {
        if (!lastAssistant?.askId) return;
        stoppedAskIds.current.add(lastAssistant.askId);
        actions.assistantStop(lastAssistant.askId);
    };

    const empty = messages.length === 0;

    return (
        <div className="flex h-full flex-col">
            {/* Header: provider + model picker */}
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6" style={{ borderBottom: "1px solid var(--c-border)" }}>
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--brand) 14%, transparent)" }}>
                        <Stars01 className="size-4.5" style={{ color: "var(--brand)" }} />
                    </span>
                    <div className="min-w-0">
                        <h1 className="truncate text-sm font-semibold text-primary">AI Chat</h1>
                        <p className="truncate text-xs text-tertiary">
                            {current ? <>{current.displayName ?? current.name}{capHints ? <> · {capHints}</> : <> · {current.provider}</>}</> : "Pick a model to start"}
                        </p>
                    </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                    {!empty && (
                        <Button size="sm" color="secondary" iconLeading={Plus} isDisabled={isBusy} onClick={() => setMessages([])}>
                            New chat
                        </Button>
                    )}
                    <ModelPicker
                        models={chatModels}
                        value={picked}
                        onChange={(provider, id) => setPicked({ provider, id })}
                        placeholder="Select a model"
                        align="right"
                        isDisabled={!state.connected}
                        unavailableReason={availability.reason}
                        onAddProvider={onNavigate ? () => onNavigate({ kind: "settings", page: "ai-providers" }) : undefined}
                    />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-secondary px-4 py-2 sm:px-6">
                <div className="w-52 shrink-0">
                    <RichSelect
                        rich
                        aria-label="Reference an agent"
                        value={agentId}
                        onChange={(event) => setAgentId(event.target.value)}
                        popoverClassName="min-w-72 max-w-80"
                        options={[
                            { value: "", label: "@Agent", supportingText: "Optional live agent context", icon: Users01 },
                            ...state.agents.map((agent) => ({
                                value: agent.id,
                                label: `@${agent.config.name}`,
                                supportingText: `${titleCase(agent.config.role)} · ${titleCase(agent.status)}`,
                                icon: Users01,
                            })),
                        ]}
                    />
                </div>
                <div className="w-52 shrink-0">
                    <RichSelect
                        rich
                        aria-label="Reference a project"
                        value={projectId}
                        onChange={(event) => setProjectId(event.target.value)}
                        popoverClassName="min-w-72 max-w-80"
                        options={[
                            { value: "", label: "@Project", supportingText: "Optional project context", icon: Folder },
                            ...state.projects.map((project) => ({ value: project.id, label: `@${project.name}`, supportingText: project.description || "Project workspace", icon: Folder })),
                        ]}
                    />
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 text-[11px] font-medium text-tertiary">Context</span>
                    {CONTEXT_AREAS.map((area) => {
                        const enabled = contextAreas.includes(area.id);
                        return (
                            <button
                                key={area.id}
                                type="button"
                                aria-pressed={enabled}
                                title={`${area.label} context ${enabled ? "enabled" : "disabled"}`}
                                onClick={() => setContextAreas((areas) =>
                                    enabled ? areas.filter((value) => value !== area.id) : [...areas, area.id]
                                )}
                                className={cx(
                                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition duration-150 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                                    enabled ? "shadow-xs" : "opacity-70 hover:opacity-100",
                                )}
                                style={{
                                    borderColor: enabled
                                        ? `color-mix(in srgb, ${area.color} 55%, var(--c-border))`
                                        : `color-mix(in srgb, ${area.color} 24%, var(--c-border))`,
                                    background: enabled
                                        ? `color-mix(in srgb, ${area.color} 16%, var(--surface))`
                                        : "var(--surface)",
                                    color: enabled ? area.color : "var(--c-text-secondary)",
                                }}
                            >
                                <span
                                    aria-hidden="true"
                                    className="size-1.5 shrink-0 rounded-full"
                                    style={{ background: area.color, opacity: enabled ? 1 : 0.55 }}
                                />
                                {area.label}
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    aria-pressed={allowActions}
                    onClick={() => setAllowActions((enabled) => !enabled)}
                    className={cx("ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition", allowActions ? "border-success bg-success-primary text-success-primary" : "border-secondary bg-primary text-tertiary hover:bg-secondary")}
                    title="Permit safe non-destructive actions only when you explicitly ask."
                >
                    <Lightning02 className="size-3.5" /> Actions {allowActions ? "On" : "Off"}
                </button>
                {(agentId || projectId) && <span className="text-[11px] text-tertiary">Ask what a selected agent is doing, or use @ scope for its project.</span>}
            </div>

            {empty ? (
                // Fresh-screen empty state: centered greeting + composer.
                <div className="flex flex-1 flex-col items-center justify-center px-4">
                    <div className="w-full max-w-2xl">
                        <div className="mb-6 flex flex-col items-center text-center">
                            <span className="mb-4 flex size-12 items-center justify-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--brand) 14%, transparent)" }}>
                                <Stars01 className="size-6" style={{ color: "var(--brand)" }} />
                            </span>
                            <h2 className="text-xl font-semibold text-primary">How can I help?</h2>
                            <p className="mt-1 text-sm text-tertiary">
                                {current ? <span className="inline-flex items-center gap-1.5"><BrandLogo domain={PROVIDER_DOMAIN[current.provider] ?? ""} name={current.provider} size={14} chip={false} />{current.displayName ?? current.name}</span> : "No AI provider connected yet."}
                            </p>
                            {!current && onNavigate && (
                                <button
                                    type="button"
                                    onClick={() => onNavigate({ kind: "settings", page: "ai-providers" })}
                                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
                                    style={{ background: "var(--brand)" }}
                                >
                                    <Plus className="size-4" /> Connect a provider
                                </button>
                            )}
                        </div>
                        <AiComposer
                            onSend={send}
                            isLoading={isBusy}
                            onStop={stop}
                            placeholder="Ask anything…"
                            hideAttach={!caps.vision}
                            accept={acceptTypes}
                            hideSearch={!caps.tools}
                            hideEffort={!caps.reasoning}
                            speech={speech}
                            isDisabled={!availability.available}
                            disabledReason={availability.reason}
                        />
                    </div>
                </div>
            ) : (
                <>
                    {/* Transcript */}
                    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
                            {messages.map((m) => {
                                const live = m.askId ? state.assistant[m.askId] : undefined;
                                const body = live ? live.content : m.text;
                                const streaming = !!live?.streaming;
                                const pending = m.role === "assistant" && !!m.askId && !live; // queued, no chunk yet
                                const error = live?.error ?? m.error ?? null;

                                if (m.role === "user") {
                                    return (
                                        <div key={m.id} className="flex justify-end">
                                            <div className="flex max-w-[85%] flex-col items-end gap-2">
                                                {m.images && m.images.length > 0 && (
                                                    <div className="flex flex-wrap justify-end gap-2">
                                                        {m.images.map((img, k) => (
                                                            <img key={k} src={img.url} alt={img.name} className="max-h-48 rounded-xl object-cover" style={{ border: "1px solid var(--c-border)" }} />
                                                        ))}
                                                    </div>
                                                )}
                                                {m.text && (
                                                    <div className="whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm text-white" style={{ background: "var(--brand)", borderBottomRightRadius: 6 }}>
                                                        {m.text}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={m.id} className="flex justify-start">
                                        <div className="flex max-w-[90%] gap-3">
                                            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                                {current ? <BrandLogo domain={PROVIDER_DOMAIN[current.provider] ?? ""} name={current.provider} size={15} chip={false} /> : <Stars01 className="size-4" style={{ color: "var(--brand)" }} />}
                                            </span>
                                            <div className="min-w-0 flex-1 rounded-2xl px-4 py-3" style={{ background: "var(--surface-2)", borderBottomLeftRadius: 6, ...(error ? { border: "1px solid color-mix(in srgb, var(--c-error, #ef4444) 50%, transparent)" } : null) }}>
                                                {error ? (
                                                    <p className="text-sm" style={{ color: "var(--c-error, #ef4444)" }}>Could not get an answer: {error}</p>
                                                ) : pending ? (
                                                    <ShiningText text="Thinking…" className="text-sm" />
                                                ) : body.length === 0 && streaming ? (
                                                    <AiLoader label="Generating" />
                                                ) : (
                                                    <>
                                                        <Markdown text={body} />
                                                        {streaming && <span className="mt-1 inline-block"><AiLoader label="Generating" size="sm" /></span>}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Composer */}
                    <div className="shrink-0 px-4 pb-4 sm:px-6" style={{ borderTop: "1px solid var(--c-border)" }}>
                        <div className="mx-auto w-full max-w-3xl pt-3">
                            <AiComposer
                                onSend={send}
                                isLoading={isBusy}
                                onStop={stop}
                                placeholder="Reply…"
                                hideAttach={!caps.vision}
                                accept={acceptTypes}
                                hideSearch={!caps.tools}
                                hideEffort={!caps.reasoning}
                                speech={speech}
                                isDisabled={!availability.available}
                                disabledReason={availability.reason}
                            />
                            <p className="mt-1.5 text-center text-[11px] text-quaternary">Responses are generated by your connected provider via the Brain.</p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
