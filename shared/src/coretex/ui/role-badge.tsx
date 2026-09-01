// @ts-nocheck
"use client";

// Coretex — the canonical role tag. One component so orchestrator/researcher/
// developer/reviewer/etc. render with identical (settings-driven) colors on every
// page (Council, Agents, Fleet, Home…). Color resolves via roleColor(role, settings).

import type { CoretexConfig } from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { roleColor } from "../use-coretex";
import { roleLabel } from "../labels";

export const RoleBadge = ({
  role,
  settings,
  size = "sm",
}: {
  role: string;
  settings: CoretexConfig | null;
  size?: "sm" | "md" | "lg";
}) => (
  <Badge size={size} color={roleColor(role, settings)} type="color">
    {roleLabel(role)}
  </Badge>
);
