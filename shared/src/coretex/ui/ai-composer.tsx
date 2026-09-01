// @ts-nocheck
"use client";

// Coretex — the AI chat composer, adapted from the pasted 21st.dev PromptInputBox
// LOOK (recreated, not the libs): a rounded-3xl bordered surface with an auto-grow
// textarea, a left tool cluster (attach / web-search toggle / effort toggle) and a
// right send button. Brand-RED tokens, motion for the pill expand, @untitledui/icons,
// cx for classes, AnchoredPopover for the effort dropdown (never clips off-screen).
//
// Behavior:
//   - Enter sends, Shift+Enter inserts a newline. Empty/whitespace-only is ignored.
//   - Attach: hidden <input type=file> (images + files), drag-drop onto the surface,
//     and paste-image support. Each attachment shows a removable chip (image thumb).
//   - Web-search: a toggle pill that expands (motion) to reveal its label when on.
//   - Effort: a "think" toggle opening an AnchoredPopover of low/medium/high/max.
//   - Send button is brand-filled with ArrowUp when there's content; while isLoading
//     it becomes a Stop button (onStop) if provided.
//   - NO lucide / radix.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Globe01,
  Lightbulb02,
  Paperclip,
  Stop,
  XClose,
  FileAttachment02,
} from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { AnchoredPopover } from "./anchored-popover";
import { MicButton } from "./mic-button";

export type Effort = "low" | "medium" | "high" | "max";

export interface ComposerSpeechOptions {
  enabled?: boolean;
  language?: string;
  pushToTalk?: boolean;
  autoSpace?: boolean;
}

const EFFORTS: { id: Effort; label: string; hint: string }[] = [
  { id: "low", label: "Low", hint: "Fast, terse" },
  { id: "medium", label: "Medium", hint: "Balanced" },
  { id: "high", label: "High", hint: "Careful, thorough" },
  { id: "max", label: "Max", hint: "Maximum reasoning" },
];

export interface ComposerAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Object URL for previews (images). Caller-side reading is its own concern. */
  url: string;
  file: File;
}

export interface ComposerSendOptions {
  attachments: ComposerAttachment[];
  search: boolean;
  effort: Effort;
}

interface Props {
  onSend: (text: string, opts: ComposerSendOptions) => boolean | void | Promise<boolean | void>;
  /** Streaming/working — disables send and (with onStop) shows a Stop button. */
  isLoading?: boolean;
  /** When provided + isLoading, the send button becomes a Stop button. */
  onStop?: () => void;
  placeholder?: string;
  /** Model/provider selector slot — rendered in the left cluster (e.g. <ModelPicker compact …>). */
  modelSlot?: ReactNode;
  /** Accepted file types for the attach picker (default images + common docs). */
  accept?: string;
  /** Initial effort (default "medium"). */
  defaultEffort?: Effort;
  /** Hide the web-search toggle. */
  hideSearch?: boolean;
  /** Hide the effort toggle. */
  hideEffort?: boolean;
  /** Hide the attach/upload button and disable drag/paste image intake (e.g. non-vision models). */
  hideAttach?: boolean;
  /** Speech-to-text mic (Settings → Microphone). */
  speech?: ComposerSpeechOptions;
  isDisabled?: boolean;
  disabledReason?: string;
  className?: string;
}

const SAFE_PREVIEW_IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const isImage = (mime: string) => SAFE_PREVIEW_IMAGE_TYPES.has(mime.toLowerCase());

export const AiComposer = ({
  onSend,
  isLoading,
  onStop,
  placeholder = "Ask anything…",
  modelSlot,
  accept = "image/avif,image/gif,image/jpeg,image/png,image/webp,.pdf,.txt,.md,.json,.csv,.docx",
  defaultEffort = "medium",
  hideSearch,
  hideEffort,
  hideAttach,
  speech,
  isDisabled,
  disabledReason,
  className,
}: Props) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [search, setSearch] = useState(false);
  const [effort, setEffort] = useState<Effort>(defaultEffort);
  const [effortOpen, setEffortOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const effortRef = useRef<HTMLButtonElement | null>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const inputId = useId();

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) {
      URL.revokeObjectURL(attachment.url);
    }
  }, []);

  const hasContent = text.trim().length > 0 || attachments.length > 0;

  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter(
      (file) => !file.type.toLowerCase().startsWith("image/") || isImage(file.type),
    );
    if (arr.length === 0) return;
    setAttachments((prev) => [
      ...prev,
      ...arr.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        url: encodeURI(URL.createObjectURL(file)),
        file,
      })),
    ]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const hit = prev.find((a) => a.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((a) => a.id !== id);
    });
  };

  const submit = async (): Promise<void> => {
    if (!hasContent || isLoading || isDisabled) return;
    try {
      const accepted = await onSend(text.trim(), { attachments, search, effort });
      if (accepted === false) return;
    } catch {
      return;
    }
    for (const attachment of attachments) {
      URL.revokeObjectURL(attachment.url);
    }
    setText("");
    setAttachments([]);
    const ta = taRef.current;
    if (ta) ta.style.height = "auto";
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (hideAttach) return;
    const imgs = Array.from(e.clipboardData.files).filter((f) =>
      isImage(f.type),
    );
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  };

  const currentEffort = EFFORTS.find((x) => x.id === effort) ?? EFFORTS[1];

  return (
    <div
      className={cx("relative w-full", className)}
      title={isDisabled ? disabledReason : undefined}
      onDragOver={(e) => {
        if (hideAttach) return;
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (hideAttach) return;
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        if (hideAttach) return;
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <div
        className={cx(
          "flex flex-col gap-2 rounded-3xl px-3 pt-3 pb-2 transition-[box-shadow,border-color] duration-150 ease-out",
          dragging && "ring-2 ring-[var(--brand)]",
        )}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--c-border)",
        }}
      >
        {/* Attachment chips */}
        <AnimatePresence initial={false}>
          {attachments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="flex flex-wrap gap-2 overflow-hidden"
            >
              {attachments.map((a) => (
                <span
                  key={a.id}
                  className="group/chip relative flex items-center gap-2 rounded-xl py-1.5 pr-2 pl-1.5 text-xs text-primary"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--c-border)",
                  }}
                >
                  {isImage(a.mime) ? (
                    <img
                      src={a.url}
                      alt={a.name}
                      className="size-8 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: "var(--surface)" }}
                    >
                      <FileAttachment02 className="size-4 text-quaternary" />
                    </span>
                  )}
                  <span className="max-w-[140px] truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                    className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-quaternary transition hover:text-primary"
                  >
                    <XClose className="size-3.5" />
                  </button>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auto-grow textarea */}
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={isDisabled}
          placeholder={placeholder}
          className="max-h-[200px] w-full resize-none bg-transparent px-1 text-sm leading-6 text-primary outline-none placeholder:text-placeholder"
        />

        {/* Bottom row: left cluster + send */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* Attach */}
            {!hideAttach && (
              <>
                <input
                  ref={fileRef}
                  id={inputId}
                  type="file"
                  multiple
                  accept={accept}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={isDisabled}
                  aria-label="Attach files"
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-quaternary transition hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  <Paperclip className="size-4.5" />
                </button>
              </>
            )}

            {speech?.enabled && (
              <MicButton
                value={text}
                onChange={(next) => {
                  setText(next);
                  requestAnimationFrame(grow);
                }}
                onTranscript={() => undefined}
                language={speech.language}
                pushToTalk={speech.pushToTalk}
                autoSpace={speech.autoSpace !== false}
                disabled={isLoading || isDisabled}
                size="md"
              />
            )}

            {/* Web-search toggle pill (motion expand) */}
            {!hideSearch && (
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => setSearch((v) => !v)}
                aria-pressed={search}
                aria-label="Toggle web search"
                className={cx(
                  "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                  search
                    ? "text-brand-secondary"
                    : "text-quaternary hover:bg-secondary hover:text-primary",
                )}
                style={
                  search
                    ? {
                        background:
                          "color-mix(in srgb, var(--brand) 14%, transparent)",
                        border:
                          "1px solid color-mix(in srgb, var(--brand) 40%, transparent)",
                      }
                    : { border: "1px solid transparent" }
                }
              >
                <Globe01 className="size-4 shrink-0" />
                <AnimatePresence initial={false}>
                  {search && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "auto", opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Search
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            )}

            {/* Effort / "think" toggle → AnchoredPopover */}
            {!hideEffort && (
              <>
                <button
                  ref={effortRef}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setEffortOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={effortOpen}
                  aria-label={`Reasoning effort: ${currentEffort.label}`}
                  className={cx(
                    "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                    effortOpen
                      ? "text-primary"
                      : "text-quaternary hover:bg-secondary hover:text-primary",
                  )}
                  style={{
                    border: "1px solid var(--c-border)",
                    background: "var(--surface-2)",
                  }}
                >
                  <Lightbulb02 className="size-4 shrink-0" />
                  <span className="whitespace-nowrap">
                    {currentEffort.label}
                  </span>
                </button>
                {effortOpen && (
                  <AnchoredPopover
                    anchorRef={effortRef}
                    onClose={() => setEffortOpen(false)}
                    role="menu"
                    aria-label="Reasoning effort"
                    className="w-52 overflow-hidden rounded-xl p-1 shadow-xl"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--c-border)",
                    }}
                  >
                    {EFFORTS.map((opt) => {
                      const sel = opt.id === effort;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={sel}
                          onClick={() => {
                            setEffort(opt.id);
                            setEffortOpen(false);
                          }}
                          className={cx(
                            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors duration-100",
                            sel ? "" : "hover:bg-secondary",
                          )}
                          style={
                            sel
                              ? {
                                  background:
                                    "color-mix(in srgb, var(--brand) 14%, transparent)",
                                }
                              : undefined
                          }
                        >
                          <span className="flex flex-col">
                            <span
                              className={cx(
                                "text-sm",
                                sel ? "text-brand-secondary" : "text-primary",
                              )}
                            >
                              {opt.label}
                            </span>
                            <span className="text-[11px] text-quaternary">
                              {opt.hint}
                            </span>
                          </span>
                          {sel && (
                            <span
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ background: "var(--brand)" }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </AnchoredPopover>
                )}
              </>
            )}

            {/* Model / provider selector slot */}
            {modelSlot && (
              <div className="ml-0.5 flex min-w-0 items-center">
                {modelSlot}
              </div>
            )}
          </div>

          {/* Send / Stop */}
          {isLoading && onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
              style={{ background: "var(--brand)" }}
            >
              <Stop className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!hasContent || isLoading || isDisabled}
              aria-label="Send message"
              className={cx(
                "flex size-9 shrink-0 items-center justify-center rounded-full transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
                hasContent && !isLoading && !isDisabled
                  ? "cursor-pointer text-white"
                  : "cursor-not-allowed text-quaternary",
              )}
              style={
                hasContent && !isLoading && !isDisabled
                  ? {
                      background: "var(--brand)",
                      boxShadow:
                        "0 0 14px color-mix(in srgb, var(--brand) 45%, transparent)",
                    }
                  : {
                      background: "var(--surface-2)",
                      border: "1px solid var(--c-border)",
                    }
              }
            >
              <ArrowUp className="size-4.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
