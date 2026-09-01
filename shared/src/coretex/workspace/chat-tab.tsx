// @ts-nocheck
"use client";

// Coretex Relay — Project Assistant. A chat grounded in the project's docs +
// indexed source code (RAG). Streams assistant replies live and renders source
// citations under each answer. The headline feature of the workspace.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ChatCitation, ChatMessage, Project } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { TextArea } from "@/components/base/textarea/textarea";
import {
  Send01,
  StopCircle,
  Trash01,
  Stars01,
  FileCode02,
  Code02,
} from "@untitledui/icons";
import { fileLabel, modelLabel, providerLabel } from "../labels";
import type { NavTarget } from "../nav";
import { liveModels, modelAvailability, type CoretexActions, type CoretexState } from "../use-coretex";
import { ComposerAttach, AttachmentChips } from "../chat/composer-attach";
import { ModelPicker } from "../ui/model-picker";
import { MicButton } from "../ui/mic-button";
import { speechOptsFor } from "../ui/speech-opts";

const SURFACE = {
  background: "var(--surface)",
  border: "1px solid var(--c-border)",
} as const;

const EXAMPLE_QUESTIONS: string[] = [
  "Explain the task queue",
  "Where is the WebSocket reconnect handled?",
  "Do my spec and the code agree on the cost tables?",
  "What does runTask do when an agent is over budget?",
];

/** Split message content into plain-text and fenced-code segments. */
interface Segment {
  code: boolean;
  text: string;
}

function splitSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```[^\n]*\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    if (match.index > last) {
      const text = content.slice(last, match.index);
      if (text.length > 0) segments.push({ code: false, text });
    }
    segments.push({ code: true, text: match[1].replace(/\n$/, "") });
    last = fence.lastIndex;
  }
  if (last < content.length) {
    const text = content.slice(last);
    if (text.length > 0) segments.push({ code: false, text });
  }
  if (segments.length === 0) segments.push({ code: false, text: content });
  return segments;
}

const CitationChip = ({ citation }: { citation: ChatCitation }) => {
  const Icon = citation.kind === "code" ? Code02 : FileCode02;
  const lines =
    citation.lineStart !== undefined
      ? ` L${citation.lineStart}-${citation.lineEnd ?? citation.lineStart}`
      : "";
  return (
    <span
      title={citation.path}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-secondary"
      style={SURFACE}
    >
      <Icon className="size-3 shrink-0 text-tertiary" />
      <span className="truncate">
        {fileLabel(citation.path)}
        {lines}
      </span>
    </span>
  );
};

const AssistantContent = ({ content }: { content: string }) => (
  <div className="flex flex-col gap-2">
    {splitSegments(content).map((seg, i) =>
      seg.code ? (
        <pre
          key={i}
          className="overflow-x-auto rounded-lg bg-secondary p-3 text-xs font-mono text-primary"
        >
          {seg.text}
        </pre>
      ) : (
        <p key={i} className="whitespace-pre-wrap text-sm text-primary">
          {seg.text}
        </p>
      ),
    )}
  </div>
);

const MessageBubble = ({ message }: { message: ChatMessage }) => {
  if (message.role === "user") {
    return (
      <div
        className="max-w-[80%] self-end rounded-xl px-4 py-2 text-sm whitespace-pre-wrap text-white"
        style={{ background: "var(--brand)" }}
      >
        {message.content}
      </div>
    );
  }
  const citations = message.citations ?? [];
  return (
    <div className="max-w-[85%] self-start rounded-xl p-4" style={SURFACE}>
      <AssistantContent content={message.content} />
      {citations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {citations.map((c, i) => (
            <CitationChip key={`${c.path}-${i}`} citation={c} />
          ))}
        </div>
      )}
    </div>
  );
};

export const ChatTab = ({
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
  const [text, setText] = useState("");
  const [clearArmed, setClearArmed] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const messages = state.chat[project.id] ?? [];
  const streaming = state.chatStreaming[project.id];
  const isStreaming = streaming !== undefined;
  const models = liveModels(state).filter((model) => !model.capabilities || model.capabilities.includes("chat"));
  const fallbackModel = models[0];
  const effectiveModel = project.assistantModel ?? (fallbackModel ? { provider: fallbackModel.provider, model: fallbackModel.id } : undefined);
  const modelState = modelAvailability(state, effectiveModel?.provider, effectiveModel?.model);
  const dailyLimitReached = Boolean(state.cost && state.cost.dailyLimit > 0 && state.cost.totalCostToday >= state.cost.dailyLimit);
  const availability = dailyLimitReached
    ? { available: false, reason: "The daily AI spend limit has been reached. Raise it in Usage & Analytics to continue." }
    : modelState;
  const chatError = state.chatErrors[project.id];

  // Load history on mount / when switching projects.
  useEffect(() => {
    actions.getChatHistory(project.id);
  }, [project.id]);

  // Auto-scroll to the bottom as messages or the live stream grow.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming?.content]);

  const currentModelLabel = project.assistantModel
    ? `${providerLabel(project.assistantModel.provider)} · ${modelLabel(project.assistantModel.model)}`
    : fallbackModel
      ? `Default · ${providerLabel(fallbackModel.provider)} · ${modelLabel(fallbackModel.id)}`
      : "Select a model";

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || isStreaming) return;
    if (actions.sendChat(project.id, trimmed)) setText("");
  };

  const clearConversation = () => {
    if (!clearArmed) {
      setClearArmed(true);
      window.setTimeout(() => setClearArmed(false), 3000);
      return;
    }
    if (actions.clearChat(project.id)) setClearArmed(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-2">
          <Stars01 className="size-5 text-brand-secondary" />
          <h2 className="text-sm font-semibold text-primary">
            Project Assistant
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-tertiary sm:inline">Model:</span>
          {/* Live catalog → shared picker (grouped by provider, searchable, capability-filtered) */}
          <ModelPicker
            models={models}
            value={
              project.assistantModel
                ? {
                    provider: project.assistantModel.provider,
                    id: project.assistantModel.model,
                  }
                : null
            }
            onChange={(provider, id) =>
              actions.setAssistantModel(project.id, provider, id)
            }
            capability="chat"
            placeholder={currentModelLabel}
            compact
            isDisabled={!state.connected || models.length === 0}
            unavailableReason={availability.reason}
            onComparePricing={
              onNavigate
                ? () => onNavigate({ kind: "settings", page: "model-pricing" })
                : undefined
            }
          />
          <Button
            size="sm"
            color={clearArmed ? "primary-destructive" : "link-destructive"}
            iconLeading={Trash01}
            isDisabled={messages.length === 0}
            onClick={clearConversation}
          >
            {clearArmed ? "Confirm clear" : "Clear"}
          </Button>
        </div>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2"
      >
        {messages.length === 0 && !isStreaming ? (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl p-8 text-center"
            style={SURFACE}
          >
            <Stars01 className="size-7 text-brand-secondary" />
            <div>
              <h3 className="text-sm font-semibold text-primary">
                Ask about this project
              </h3>
              <p className="mt-1 text-xs text-tertiary">
                Grounded in your project docs and indexed source code.
              </p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => { if (availability.available) actions.sendChat(project.id, q); }}
                  disabled={!availability.available}
                  className="rounded-lg px-3 py-1.5 text-xs text-secondary transition hover:text-primary"
                  style={SURFACE}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {/* Live streaming reply */}
            {streaming && (
              <div
                className="max-w-[85%] self-start rounded-xl p-4"
                style={SURFACE}
              >
                <p className="whitespace-pre-wrap text-sm text-primary">
                  {streaming.content}
                  <span className="ml-0.5 inline-block w-1.5 animate-pulse text-brand-secondary">
                    ▍
                  </span>
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 pt-3">
        {(!availability.available || chatError) && (
          <div role="alert" className="mb-2 rounded-lg px-3 py-2 text-xs text-warning-primary" style={{ background: "color-mix(in srgb, #f59e0b 10%, var(--surface))", border: "1px solid color-mix(in srgb, #f59e0b 35%, var(--c-border))" }}>
            {chatError || availability.reason}
          </div>
        )}
        <AttachmentChips chatId={project.id} state={state} actions={actions} />
        <div className="flex items-end gap-2">
          <ComposerAttach
            chatId={project.id}
            state={state}
            actions={actions}
            disabled={isStreaming || !availability.available}
            allowedIntegrationIds={project.connectorIds ?? []}
          />
          {speechOptsFor(state.settings?.speech, "projectChat") && (
            <MicButton
              size="md"
              value={text}
              onChange={setText}
              onTranscript={() => undefined}
              language={state.settings?.speech?.language}
              pushToTalk={state.settings?.speech?.pushToTalk === true}
              autoSpace={state.settings?.speech?.autoSpace !== false}
              disabled={isStreaming || !availability.available}
              className="mb-1"
            />
          )}
          <div className="flex-1">
            <TextArea
              value={text}
              onChange={setText}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="Ask about this project… (Enter to send, Shift+Enter for newline)"
              isDisabled={isStreaming || !availability.available}
              textAreaClassName="resize-none"
            />
          </div>
          {isStreaming ? (
            <Button
              size="md"
              color="secondary"
              iconLeading={StopCircle}
              onClick={() => actions.stopChat(project.id)}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="md"
              color="primary"
              iconLeading={Send01}
              isDisabled={text.trim().length === 0 || !availability.available}
              onClick={submit}
            >
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
