"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { cx } from "@/utils/cx";
import { CANVAS_PANEL_STYLE, type CanvasIcon } from "./shared-canvas";

export type CanvasDockTone = "default" | "brand" | "danger";

export interface CanvasDockViewMode<T extends string = string> {
  id: T;
  label: string;
  icon: CanvasIcon;
  description?: string;
  shortcut?: string;
  disabled?: boolean;
}

export interface CanvasDockAction {
  id: string;
  label: string;
  icon: CanvasIcon;
  onClick: () => void;
  description?: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  tone?: CanvasDockTone;
  /** Keep a text label beside the icon on wider layouts. */
  showLabel?: boolean;
  /** Optional compact count or status, such as the number of selected objects. */
  badge?: ReactNode;
}

export interface CanvasActionDockProps<T extends string = string> {
  label?: string;
  viewModes?: readonly CanvasDockViewMode<T>[];
  activeView?: T;
  onViewChange?: (view: T) => void;
  primaryAction?: CanvasDockAction;
  actions?: readonly CanvasDockAction[];
  /** Reserves space from tablet widths upward for the standard 20rem canvas inspector. */
  inspectorOpen?: boolean;
  className?: string;
}

const CONTROL_SELECTOR =
  "[data-canvas-dock-control='true']:not([disabled]):not([aria-disabled='true'])";

function focusAdjacentControl(event: KeyboardEvent<HTMLDivElement>) {
  const keys = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ];
  if (!keys.includes(event.key)) return;

  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(CONTROL_SELECTOR),
  );
  if (controls.length === 0) return;

  const target =
    event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>(CONTROL_SELECTOR)
      : null;
  const currentIndex = target ? controls.indexOf(target) : -1;
  let nextIndex = currentIndex;

  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = controls.length - 1;
  else if (event.key === "ArrowRight" || event.key === "ArrowDown")
    nextIndex = (currentIndex + 1 + controls.length) % controls.length;
  else nextIndex = (currentIndex - 1 + controls.length) % controls.length;

  event.preventDefault();
  controls[nextIndex]?.focus();
}

function DockDivider() {
  return (
    <span
      aria-hidden="true"
      className="mx-0.5 h-6 w-px shrink-0 bg-border-secondary"
    />
  );
}

function tooltipDescription(description?: string, shortcut?: string) {
  return [description, shortcut ? `Shortcut: ${shortcut}` : undefined]
    .filter(Boolean)
    .join(" · ");
}

function ViewModeButton<T extends string>({
  mode,
  selected,
  onSelect,
}: {
  mode: CanvasDockViewMode<T>;
  selected: boolean;
  onSelect: (view: T) => void;
}) {
  const Icon = mode.icon;
  return (
    <Tooltip
      title={`${mode.label} view`}
      description={tooltipDescription(mode.description, mode.shortcut)}
      placement="top"
    >
      <TooltipTrigger
        type="button"
        data-canvas-dock-control="true"
        aria-label={`${mode.label} view`}
        aria-pressed={selected}
        aria-keyshortcuts={mode.shortcut}
        isDisabled={mode.disabled}
        onClick={() => onSelect(mode.id)}
        className={cx(
          "flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs font-semibold outline-none transition",
          "focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
          "disabled:cursor-not-allowed disabled:opacity-40",
          selected
            ? "bg-secondary text-primary shadow-xs"
            : "text-tertiary hover:bg-secondary hover:text-primary",
        )}
      >
        <Icon className={cx("size-4", selected && "text-brand-secondary")} />
        <span className="hidden sm:inline">{mode.label}</span>
      </TooltipTrigger>
    </Tooltip>
  );
}

function DockActionButton({
  action,
  primary = false,
}: {
  action: CanvasDockAction;
  primary?: boolean;
}) {
  const Icon = action.icon;
  const tone = action.tone ?? (primary ? "brand" : "default");
  const showLabel = primary || action.showLabel;

  return (
    <Tooltip
      title={action.label}
      description={tooltipDescription(action.description, action.shortcut)}
      placement="top"
    >
      <TooltipTrigger
        type="button"
        data-canvas-dock-control="true"
        aria-label={action.label}
        aria-pressed={action.active}
        aria-keyshortcuts={action.shortcut}
        isDisabled={action.disabled}
        onClick={action.onClick}
        className={cx(
          "relative flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-2.5 text-xs font-semibold outline-none transition",
          "focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
          "disabled:cursor-not-allowed disabled:opacity-40",
          tone === "brand" &&
            "bg-brand-solid text-white shadow-xs hover:bg-brand-solid_hover",
          tone === "danger" &&
            (action.active
              ? "bg-error-solid text-white"
              : "text-error-primary hover:bg-error-primary"),
          tone === "default" &&
            (action.active
              ? "bg-secondary text-brand-secondary shadow-xs"
              : "text-tertiary hover:bg-secondary hover:text-primary"),
        )}
      >
        <Icon className="size-4" />
        {showLabel && (
          <span
            className={cx(
              primary ? "hidden min-[430px]:inline" : "hidden lg:inline",
            )}
          >
            {action.label}
          </span>
        )}
        {action.badge != null && (
          <span
            className={cx(
              "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
              tone === "brand"
                ? "bg-white/20 text-white"
                : "bg-tertiary text-secondary",
            )}
          >
            {action.badge}
          </span>
        )}
      </TooltipTrigger>
    </Tooltip>
  );
}

/**
 * Shared bottom action dock for project, agent, and social graph/grid surfaces.
 * The dock owns layout and keyboard behavior; each surface supplies its domain actions.
 */
export function CanvasActionDock<T extends string = string>({
  label = "Canvas actions",
  viewModes = [],
  activeView,
  onViewChange,
  primaryAction,
  actions = [],
  inspectorOpen = false,
  className,
}: CanvasActionDockProps<T>) {
  const hasViews = viewModes.length > 0 && Boolean(onViewChange);
  const hasActions = actions.length > 0;

  if (!hasViews && !hasActions && !primaryAction) return null;

  return (
    <div
      data-canvas-action-dock="true"
      className={cx(
        "pointer-events-none absolute inset-x-3 z-40 flex justify-center transition-[padding] duration-200",
        inspectorOpen && "md:pr-80",
        className,
      )}
      // The global Ask AI launcher occupies the bottom-center 4rem band.
      // Keep canvas actions above it while still honoring mobile safe areas.
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div
        role="toolbar"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={focusAdjacentControl}
        onPointerDown={(event) => event.stopPropagation()}
        className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl p-1.5 shadow-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={CANVAS_PANEL_STYLE}
      >
        {hasViews && (
          <div
            role="group"
            aria-label="View"
            className="flex shrink-0 items-center gap-0.5"
          >
            {viewModes.map((mode) => (
              <ViewModeButton
                key={mode.id}
                mode={mode}
                selected={activeView === mode.id}
                onSelect={onViewChange!}
              />
            ))}
          </div>
        )}

        {hasViews && (hasActions || primaryAction) && <DockDivider />}

        {hasActions && (
          <div
            role="group"
            aria-label="Tools"
            className="flex shrink-0 items-center gap-0.5"
          >
            {actions.map((action) => (
              <DockActionButton key={action.id} action={action} />
            ))}
          </div>
        )}

        {hasActions && primaryAction && <DockDivider />}

        {primaryAction && <DockActionButton action={primaryAction} primary />}
      </div>
    </div>
  );
}
