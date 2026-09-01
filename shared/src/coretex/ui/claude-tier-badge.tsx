// @ts-nocheck
"use client";

// Coretex — UI for the 3 Claude execution tiers (conversational / assisted / autonomous).
//  - <ClaudeTierBadge mode/> : a compact pill (Untitled UI BadgeWithIcon) — tier icon + label,
//    colored by the tier's tone. Brand RED accent; no blue/violet.
//  - <ClaudeTierSelect value onChange/> : a segmented control (ButtonGroup) with a colored
//    dot per tier, mirroring permission-mode-select. Tier order: conversational → autonomous.

import { cx } from "@/utils/cx";
import {
  BadgeWithIcon,
  type BadgeColor,
} from "@/components/base/badges/badges";
import {
  ButtonGroup,
  ButtonGroupItem,
} from "@/components/base/button-group/button-group";
import {
  CLAUDE_TIERS,
  CLAUDE_TIER_ORDER,
  type ClaudeExecutionMode,
  type ClaudeTierTone,
} from "../claude-tiers";

/** Tier tone → Untitled UI Badge color. brand = brand RED. */
export function claudeTierBadgeColor(
  tone: ClaudeTierTone,
): BadgeColor<"color"> {
  return tone;
}

/** Tier tone → a CSS color for the segmented-control dot (tokenized). */
function claudeTierDotColor(tone: ClaudeTierTone): string {
  switch (tone) {
    case "brand":
      return "var(--brand)";
    case "success":
      return "var(--c-success)";
    case "warning":
      return "var(--c-warning)";
    case "gray":
    default:
      return "var(--c-text-secondary)";
  }
}

interface BadgeProps {
  mode: ClaudeExecutionMode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const ClaudeTierBadge = ({
  mode,
  size = "sm",
  className,
}: BadgeProps) => {
  const tier = CLAUDE_TIERS[mode];
  return (
    <BadgeWithIcon
      type="color"
      size={size}
      color={claudeTierBadgeColor(tier.tone)}
      iconLeading={tier.icon}
      className={className}
    >
      {tier.label}
    </BadgeWithIcon>
  );
};

interface SelectProps {
  value: ClaudeExecutionMode;
  onChange: (mode: ClaudeExecutionMode) => void;
  size?: "sm" | "md";
  className?: string;
}

export const ClaudeTierSelect = ({
  value,
  onChange,
  size = "sm",
  className,
}: SelectProps) => (
  <ButtonGroup
    aria-label="Execution mode"
    size={size}
    selectedKeys={[value]}
    onSelectionChange={(keys) => {
      const next = [...keys][0] as ClaudeExecutionMode | undefined;
      if (next) onChange(next);
    }}
    className={cx(className)}
  >
    {CLAUDE_TIER_ORDER.map((mode) => {
      const tier = CLAUDE_TIERS[mode];
      return (
        <ButtonGroupItem key={mode} id={mode}>
          <span className="flex items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: claudeTierDotColor(tier.tone) }}
              aria-hidden="true"
            />
            {tier.label}
          </span>
        </ButtonGroupItem>
      );
    })}
  </ButtonGroup>
);
