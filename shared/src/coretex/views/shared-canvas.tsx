"use client";

import type { ComponentType, ReactNode } from "react";
import { Minus, Plus, RefreshCcw01, XClose } from "@untitledui/icons";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { cx } from "@/utils/cx";

export type CanvasIcon = ComponentType<{ className?: string }>;

export const CANVAS_PANEL_STYLE = {
    background: "var(--surface)",
    border: "1px solid var(--c-border)",
} as const;

export function CanvasToolRail({ label = "Canvas tools", children }: { label?: string; children: ReactNode }) {
    return (
        <div
            role="toolbar"
            aria-label={label}
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute left-3 top-3 z-40 flex flex-col gap-1 rounded-lg p-1.5 shadow-lg"
            style={CANVAS_PANEL_STYLE}
        >
            {children}
        </div>
    );
}

export function CanvasToolButton({
    icon: Icon,
    label,
    description,
    shortcut,
    active = false,
    onClick,
}: {
    icon: CanvasIcon;
    label: string;
    description: string;
    shortcut?: string;
    active?: boolean;
    onClick: () => void;
}) {
    return (
        <Tooltip title={label} description={[description, shortcut].filter(Boolean).join(" · ")} placement="right">
            <TooltipTrigger
                type="button"
                aria-label={shortcut ? `${label} (${shortcut})` : label}
                aria-pressed={active}
                onClick={onClick}
                className={cx(
                    "flex size-9 items-center justify-center rounded-md text-secondary outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
                    active ? "bg-brand-solid text-white shadow-xs" : "hover:bg-secondary hover:text-primary",
                )}
            >
                <Icon className="size-4" />
            </TooltipTrigger>
        </Tooltip>
    );
}

export function CanvasCommandBar({ label = "Canvas view controls", children, inspectorOpen = false }: { label?: string; children: ReactNode; inspectorOpen?: boolean }) {
    return (
        <div
            role="toolbar"
            aria-label={label}
            onPointerDown={(event) => event.stopPropagation()}
            data-inspector-open={inspectorOpen || undefined}
            className="absolute right-3 top-3 z-40 flex max-w-[calc(100%-4.75rem)] items-center gap-1 overflow-x-auto rounded-lg p-1.5 shadow-lg"
            style={CANVAS_PANEL_STYLE}
        >
            {children}
        </div>
    );
}

export function CanvasUtilityButton({ icon: Icon, label, active, onClick, disabled = false }: { icon: CanvasIcon; label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
    return (
        <Tooltip title={label} placement="top">
            <TooltipTrigger
                type="button"
                aria-label={label}
                aria-pressed={active}
                isDisabled={disabled}
                onClick={onClick}
                className={cx(
                    "flex size-8 shrink-0 items-center justify-center rounded-md text-tertiary outline-none transition hover:bg-secondary hover:text-primary focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40",
                    active && "bg-secondary text-brand-secondary",
                )}
            >
                <Icon className="size-4" />
            </TooltipTrigger>
        </Tooltip>
    );
}

export function CanvasZoomControls({ zoom, onZoomOut, onZoomIn, onReset }: { zoom: number; onZoomOut: () => void; onZoomIn: () => void; onReset: () => void }) {
    return (
        <div
            role="toolbar"
            aria-label="Canvas zoom controls"
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute bottom-3 left-3 z-40 flex items-center gap-2"
        >
            <div className="flex items-center gap-0.5 rounded-lg p-1 shadow-md" style={CANVAS_PANEL_STYLE}>
                <CanvasUtilityButton icon={Minus} label="Zoom out" onClick={onZoomOut} />
                <output aria-label={`Zoom ${Math.round(zoom * 100)} percent`} className="min-w-12 text-center text-xs font-medium tabular-nums text-secondary">
                    {Math.round(zoom * 100)}%
                </output>
                <CanvasUtilityButton icon={Plus} label="Zoom in" onClick={onZoomIn} />
            </div>
            <div className="rounded-lg p-1 shadow-md" style={CANVAS_PANEL_STYLE}>
                <CanvasUtilityButton icon={RefreshCcw01} label="Reset zoom and pan" onClick={onReset} />
            </div>
        </div>
    );
}

export function CanvasGuidePanel({ title = "Canvas guide", icon: Icon, onClose, children }: { title?: string; icon: CanvasIcon; onClose: () => void; children: ReactNode }) {
    return (
        <section
            aria-label={title}
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute right-3 top-14 z-50 w-[min(18rem,calc(100%-1.5rem))] overflow-hidden rounded-xl shadow-2xl"
            style={CANVAS_PANEL_STYLE}
        >
            <div className="flex items-center justify-between border-b border-secondary px-3 py-2">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-primary"><Icon className="size-4 text-brand-secondary" />{title}</h2>
                <CanvasUtilityButton icon={XClose} label={`Close ${title.toLowerCase()}`} onClick={onClose} />
            </div>
            <div className="flex flex-col gap-2.5 p-3 text-xs text-tertiary">{children}</div>
        </section>
    );
}

export function CanvasInspectorPanel({ eyebrow = "Inspector", title, subtitle, onClose, children, footer, className }: { eyebrow?: string; title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; className?: string }) {
    return (
        <aside
            aria-label={`${title} inspector`}
            onPointerDown={(event) => event.stopPropagation()}
            className={cx(
                "absolute inset-y-3 right-3 z-50 flex w-[min(22rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl shadow-xl xl:static xl:inset-auto xl:w-80 xl:shrink-0",
                className,
            )}
            style={CANVAS_PANEL_STYLE}
        >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-secondary px-4 py-3">
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-quaternary">{eyebrow}</p>
                    <h2 className="break-words text-sm font-semibold leading-5 text-primary [overflow-wrap:anywhere]" title={title}>{title}</h2>
                    {subtitle && <p className="mt-0.5 break-words text-xs leading-4 text-tertiary [overflow-wrap:anywhere]" title={subtitle}>{subtitle}</p>}
                </div>
                <CanvasUtilityButton icon={XClose} label="Close inspector" onClick={onClose} />
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4">{children}</div>
            {footer && <div className="shrink-0 border-t border-secondary p-3">{footer}</div>}
        </aside>
    );
}

export function CanvasGuideItem({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div>
            <p className="font-semibold text-secondary">{title}</p>
            <p className="mt-0.5 leading-relaxed">{children}</p>
        </div>
    );
}
