// @ts-nocheck
"use client";

// Coretex — account control in the sidebar footer. Collapsed shows just the
// avatar; expanded shows avatar + name + email with a chevron. Clicking opens a
// dropdown (profile, settings, theme, check-for-updates, sign in/out) plus the
// app version + update channel. No real auth backend yet, so "sign in/out" routes
// to Settings → Account where the connection state lives.

import {
  ChevronSelectorVertical,
  LifeBuoy01,
  LogIn01,
  LogOut01,
  Moon01,
  RefreshCcw02,
  Settings01,
  Sun,
  User01,
} from "@untitledui/icons";
import { Button as AriaButton } from "react-aria-components";
import { Avatar } from "@/components/base/avatar/avatar";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { cx } from "@/utils/cx";
import { useTheme } from "../theme";
import type { NavTarget } from "../nav";
import {
  CORETEX_VERSION,
  channelLabel,
  loadUpdateChannel,
  RELEASES_URL,
} from "../version";

export interface AccountInfo {
  name: string;
  email: string;
  avatarUrl?: string;
}

interface Props {
  collapsed: boolean;
  connected: boolean;
  account?: AccountInfo;
  onNavigate: (target: NavTarget) => void;
  onStartTour?: () => void;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CX";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export const AccountMenu = ({
  collapsed,
  connected,
  account,
  onNavigate,
  onStartTour,
}: Props) => {
  const theme = useTheme();
  const isDark = theme.resolved === "dark";

  const name = account?.name?.trim() || "Local workspace";
  const email =
    account?.email?.trim() || (connected ? "Connected" : "Not signed in");

  return (
    <Dropdown.Root>
      <AriaButton
        aria-label="Account"
        className={({ isPressed, isFocused }) =>
          cx(
            "relative flex w-full cursor-pointer items-center gap-2 rounded-lg p-1.5 text-left outline-offset-2 outline-focus-ring transition hover:bg-[var(--surface-2)]",
            collapsed && "justify-center",
            (isPressed || isFocused) && "outline-2",
          )
        }
      >
        <Avatar
          size="sm"
          src={account?.avatarUrl || undefined}
          initials={initialsOf(name)}
          className="shrink-0"
        />
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-sm font-semibold"
                style={{ color: "var(--c-text-primary)" }}
              >
                {name}
              </p>
              <p
                className="truncate text-xs"
                style={{ color: "var(--c-text-muted)" }}
              >
                {email}
              </p>
            </div>
            <ChevronSelectorVertical
              className="size-4 shrink-0 stroke-[2.25px]"
              style={{ color: "var(--c-text-muted)" }}
            />
          </>
        )}
      </AriaButton>

      <Dropdown.Popover className="w-60" placement="top start">
        {/* Account header */}
        <div className="flex items-center gap-2.5 border-b border-secondary px-3.5 py-3">
          <Avatar
            size="md"
            src={account?.avatarUrl || undefined}
            initials={initialsOf(name)}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-primary">
              {name}
            </p>
            <p className="truncate text-xs text-tertiary">{email}</p>
          </div>
        </div>

        <Dropdown.Menu selectionMode="none">
          <Dropdown.Item
            icon={User01}
            onAction={() => onNavigate({ kind: "settings" })}
          >
            View profile
          </Dropdown.Item>
          <Dropdown.Item
            icon={Settings01}
            onAction={() => onNavigate({ kind: "settings" })}
          >
            Settings
          </Dropdown.Item>
          <Dropdown.Item
            icon={isDark ? Sun : Moon01}
            onAction={() => theme.setMode(isDark ? "light" : "dark")}
          >
            {isDark ? "Light mode" : "Dark mode"}
          </Dropdown.Item>

          <Dropdown.Separator />

          {onStartTour && (
            <Dropdown.Item icon={LifeBuoy01} onAction={onStartTour}>
              Take the tour
            </Dropdown.Item>
          )}
          <Dropdown.Item
            icon={RefreshCcw02}
            onAction={() => onNavigate({ kind: "settings", page: "about" })}
          >
            Check for updates
          </Dropdown.Item>

          <Dropdown.Separator />

          {connected ? (
            <Dropdown.Item
              icon={LogOut01}
              onAction={() => onNavigate({ kind: "settings" })}
            >
              Sign out
            </Dropdown.Item>
          ) : (
            <Dropdown.Item
              icon={LogIn01}
              onAction={() => onNavigate({ kind: "settings" })}
            >
              Sign in
            </Dropdown.Item>
          )}
        </Dropdown.Menu>

        {/* Version + channel footer */}
        <div className="flex items-center justify-between border-t border-secondary px-3.5 py-2.5">
          <span className="text-xs text-quaternary">
            Coretex v{CORETEX_VERSION}
          </span>
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize text-tertiary transition hover:text-secondary"
            style={{ border: "1px solid var(--c-border)" }}
            title="Open releases on GitHub"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(RELEASES_URL, "_blank", "noopener,noreferrer");
            }}
          >
            {channelLabel(loadUpdateChannel())}
          </button>
        </div>
      </Dropdown.Popover>
    </Dropdown.Root>
  );
};
