"use client";

import type { ReactNode } from "react";
import { X } from "@untitledui/icons";
import type { WidgetDefinition } from "@/components/app-shell/floating-widgets/widget-config";
import { useFloatingWidget, VIEWPORT_MARGIN } from "@/components/app-shell/floating-widgets/use-floating-widget";

interface Props {
    def: WidgetDefinition;
    onClose: () => void;
    onFocus: () => void;
    zIndex: number;
    children: ReactNode;
}

/** Draggable, resizable popout shell — position and size persist per widget. */
export function FloatingWidgetShell({ def, onClose, onFocus, zIndex, children }: Props) {
    const Icon = def.icon;
    const { ready, position, size, shellRef, onHeaderPointerDown, onResizePointerDown } = useFloatingWidget(def);

    if (!ready) return null;

    return (
        <div
            ref={shellRef}
            className="fixed flex flex-col overflow-hidden rounded-xl bg-primary shadow-xl ring-1 ring-primary dark:shadow-[0_0_0_1px_rgb(255_255_255/0.10),0_24px_48px_-12px_rgb(0_0_0/0.75)]"
            style={{
                left: position.x,
                top: position.y,
                width: size.width,
                height: size.height,
                maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
                maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`,
                zIndex,
            }}
            onPointerDown={onFocus}
        >
            <div
                className="relative flex shrink-0 cursor-grab touch-none items-center justify-center border-b border-secondary bg-primary px-9 py-2 active:cursor-grabbing"
                onPointerDown={onHeaderPointerDown}
            >
                <h2 className="flex min-w-0 items-center justify-center gap-2 truncate text-sm font-semibold text-primary">
                    <Icon className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                    <span className="truncate">{def.label}</span>
                </h2>
                <button
                    type="button"
                    aria-label={`Close ${def.label}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onClose}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-fg-quaternary transition hover:bg-primary_hover hover:text-fg-quaternary_hover"
                >
                    <X className="size-4" aria-hidden="true" />
                </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>

            {/* Bottom-left resize gripper (grows leftward, right edge anchored). */}
            <button
                type="button"
                aria-label={`Resize ${def.label}`}
                className="absolute bottom-0 left-0 z-10 size-5 cursor-sw-resize touch-none"
                onPointerDown={(e) => onResizePointerDown(e, "sw")}
            >
                <span className="absolute bottom-1 left-1 block size-2.5 rounded-bl border-b-2 border-l-2 border-tertiary" aria-hidden="true" />
            </button>

            {/* Bottom-right resize gripper (grows rightward / downward). */}
            <button
                type="button"
                aria-label={`Resize ${def.label}`}
                className="absolute right-0 bottom-0 z-10 size-5 cursor-se-resize touch-none"
                onPointerDown={(e) => onResizePointerDown(e, "se")}
            >
                <span className="absolute right-1 bottom-1 block size-2.5 rounded-br border-r-2 border-b-2 border-tertiary" aria-hidden="true" />
            </button>
        </div>
    );
}
