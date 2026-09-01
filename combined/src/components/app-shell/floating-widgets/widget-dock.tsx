"use client";

import { useState } from "react";
import { Grid01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { useFloatingWidgets } from "@/components/app-shell/floating-widgets/floating-widgets-context";
import { WIDGET_DEFINITIONS } from "@/components/app-shell/floating-widgets/widget-config";

/**
 * Bottom-right widget controller. Collapsed it's a floating launcher button; hovering
 * (or focusing / tapping) it expands a panel of widget toggles. Moving the pointer
 * away shrinks it again. Toggling still opens/minimizes the popout widgets exactly
 * as before — only the launcher's look and reveal behavior were refined.
 */
export function WidgetDock({ hiddenWidgets = [] }: { hiddenWidgets?: string[] }) {
    const { isOpen, toggle } = useFloatingWidgets();
    const [expanded, setExpanded] = useState(false);
    const widgets = WIDGET_DEFINITIONS.filter((def) => !hiddenWidgets.includes(def.id));

    if (widgets.length === 0) return null;

    const activeCount = widgets.filter((def) => isOpen(def.id)).length;

    return (
        <div
            className="pointer-events-auto fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-[100] flex flex-col items-end gap-2.5"
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => setExpanded(false)}
            onFocusCapture={() => setExpanded(true)}
            onBlurCapture={(e) => {
                // Collapse once focus leaves the whole controller.
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setExpanded(false);
            }}
        >
            {/* Expanding toggle panel (above the trigger). */}
            <div
                role="toolbar"
                aria-label="Widget launcher"
                aria-hidden={!expanded}
                className={cx(
                    "flex w-72 origin-bottom-right flex-col gap-1 rounded-2xl bg-primary/80 shadow-lg ring-1 ring-secondary backdrop-blur-md transition-all duration-200 ease-out dark:bg-primary/85 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06),0_16px_40px_-12px_rgb(0_0_0/0.7)]",
                    "motion-reduce:transition-none",
                    expanded
                        ? "max-h-[70vh] translate-y-0 scale-100 overflow-y-auto p-2 opacity-100"
                        : "pointer-events-none max-h-0 translate-y-1 scale-95 overflow-hidden p-0 opacity-0 motion-reduce:transform-none",
                )}
            >
                {widgets.map((def) => {
                    const Icon = def.icon;
                    const active = isOpen(def.id);
                    return (
                        <button
                            key={def.id}
                            type="button"
                            tabIndex={expanded ? 0 : -1}
                            title={def.label}
                            aria-label={`${active ? "Minimize" : "Open"} ${def.label}`}
                            aria-pressed={active}
                            onClick={() => toggle(def.id)}
                            className={cx(
                                "group/dock-item flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-offset-2",
                                active
                                    ? "bg-brand-primary text-brand-secondary ring-1 ring-brand"
                                    : "text-secondary hover:bg-secondary_hover hover:text-primary",
                            )}
                        >
                            <Icon
                                className={cx("size-4 shrink-0", active ? "text-fg-brand-primary" : "text-fg-quaternary group-hover/dock-item:text-fg-secondary")}
                                aria-hidden="true"
                            />
                            <span className="flex-1 truncate text-left">{def.label}</span>
                            {active && (
                                <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
                                    <span className="absolute inline-flex size-2 animate-ping rounded-full bg-fg-brand-primary opacity-60 motion-reduce:animate-none" />
                                    <span className="relative inline-flex size-1.5 rounded-full bg-fg-brand-primary" />
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Always-visible trigger. */}
            <button
                type="button"
                aria-label="Widgets"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
                className={cx(
                    "relative flex size-14 items-center justify-center rounded-full bg-primary/80 text-secondary shadow-lg ring-1 ring-secondary backdrop-blur-md outline-focus-ring transition duration-150 ease-out",
                    "hover:-translate-y-0.5 hover:text-primary hover:shadow-xl active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2",
                    "motion-reduce:transform-none motion-reduce:transition-none",
                    "dark:bg-primary/85 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06),0_16px_40px_-12px_rgb(0_0_0/0.7)]",
                    expanded && "text-primary ring-brand",
                )}
            >
                <Grid01 className="size-6" aria-hidden="true" />
                {activeCount > 0 && (
                    <span className="absolute top-0 right-0 flex size-5 items-center justify-center rounded-full bg-brand-solid text-[11px] font-bold text-white ring-2 ring-bg-primary animate-pulse motion-reduce:animate-none">
                        {activeCount}
                    </span>
                )}
            </button>
        </div>
    );
}
