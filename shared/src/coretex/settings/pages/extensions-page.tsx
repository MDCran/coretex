"use client";

// Coretex — Extensions roadmap. The extension runtime does not ship yet, so
// this page is intentionally informational and contains no install controls.

import type { CoretexConfig } from "@repo/coretex/types";
import type { CoretexState, CoretexActions } from "../../use-coretex";
import { Badge } from "@/components/base/badges/badges";
import {
  CodeBrowser,
  Lock01,
  Package,
  PuzzlePiece01,
  Rocket01,
  ShieldTick,
  Stars01,
  Terminal,
} from "@untitledui/icons";
import {
  SettingsPageHeader,
  SettingsStatusBadge,
  SETTINGS_SURFACE,
} from "../settings-shell";
import { SettingsSection } from "../controls";

interface PageProps {
  settings: CoretexConfig;
  state: CoretexState;
  actions: CoretexActions;
}

const LAUNCH_REQUIREMENTS = [
  {
    icon: CodeBrowser,
    step: "01",
    title: "Secure extension runtime",
    body: "Isolated execution, a stable extension API, and clear boundaries between packages and your workspace.",
  },
  {
    icon: ShieldTick,
    step: "02",
    title: "Review and permissions",
    body: "Signed packages, human-readable capability requests, and approval before an extension can access anything.",
  },
  {
    icon: Package,
    step: "03",
    title: "Marketplace and lifecycle",
    body: "A trusted catalog with dependable install, update, disable, and removal flows managed in one place.",
  },
] as const;

const PLANNED_CAPABILITIES = [
  {
    icon: Terminal,
    title: "Terminal profiles",
    body: "Add shells, themes, shortcuts, and reusable pane layouts.",
  },
  {
    icon: Stars01,
    title: "Agent capabilities",
    body: "Give agents purpose-built tools through reviewed permission grants.",
  },
  {
    icon: CodeBrowser,
    title: "Commands and tools",
    body: "Contribute command-palette actions and focused workspace utilities.",
  },
  {
    icon: PuzzlePiece01,
    title: "Workspace experiences",
    body: "Introduce new panels and workflows without changing the Coretex foundation.",
  },
] as const;

export const ExtensionsPage = (_props: PageProps) => {
  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader
        icon={PuzzlePiece01}
        title="Extensions"
        subtitle="A preview of the planned Coretex extension platform."
        badges={
          <>
            <SettingsStatusBadge label="Coming soon" color="warning" />
            <SettingsStatusBadge label="Roadmap preview" color="gray" />
          </>
        }
      />

      <section
        className="relative isolate overflow-hidden rounded-2xl px-6 py-8 sm:px-8 sm:py-10"
        style={{
          ...SETTINGS_SURFACE,
          background:
            "radial-gradient(circle at 82% 8%, color-mix(in srgb, var(--c-warning, #f59e0b) 12%, transparent), transparent 32%), radial-gradient(circle at 10% 100%, color-mix(in srgb, var(--brand) 10%, transparent), transparent 38%), var(--surface)",
        }}
        aria-labelledby="extensions-preview-title"
      >
        <div
          className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full opacity-40"
          style={{
            border:
              "1px solid color-mix(in srgb, var(--c-warning, #f59e0b) 18%, transparent)",
          }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-4 -top-12 size-40 rounded-full opacity-60"
          style={{
            border:
              "1px solid color-mix(in srgb, var(--c-warning, #f59e0b) 22%, transparent)",
          }}
          aria-hidden="true"
        />

        <div className="relative flex max-w-3xl flex-col items-start">
          <div
            className="mb-5 grid size-12 place-items-center rounded-xl"
            style={{
              background:
                "color-mix(in srgb, var(--c-warning, #f59e0b) 13%, var(--surface))",
              border:
                "1px solid color-mix(in srgb, var(--c-warning, #f59e0b) 28%, var(--c-border))",
            }}
          >
            <Lock01
              className="size-5 text-warning-primary"
              aria-hidden="true"
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge size="sm" color="warning" type="pill-color">
              Locked until launch
            </Badge>
            <span className="text-xs font-medium text-quaternary">
              No release date announced
            </span>
          </div>

          <h2
            id="extensions-preview-title"
            className="text-display-sm font-semibold tracking-tight text-primary"
          >
            The extension platform is coming soon
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-tertiary">
            Extensions are not available in this build. There is no marketplace,
            extension runtime, or package installation yet—this page is a
            preview of what Coretex plans to support when the platform is ready.
          </p>

          <div
            className="mt-6 flex max-w-2xl items-start gap-3 rounded-xl px-4 py-3.5"
            style={{
              background:
                "color-mix(in srgb, var(--surface-2) 86%, transparent)",
              border: "1px solid var(--c-border)",
            }}
          >
            <Rocket01
              className="mt-0.5 size-4 shrink-0 text-secondary"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-primary">
                Built for a complete launch
              </p>
              <p className="mt-0.5 text-xs leading-5 text-tertiary">
                Installation will stay locked until package review, permission
                controls, updates, and safe removal are ready together.
              </p>
            </div>
          </div>
        </div>
      </section>

      <SettingsSection
        title="Path to launch"
        description="The platform will open only after these foundations are in place. This is a product roadmap, not a live progress tracker."
      >
        <div className="grid gap-3 py-1 lg:grid-cols-3">
          {LAUNCH_REQUIREMENTS.map((item) => {
            const Icon = item.icon;
            return (
              <article
                key={item.step}
                className="relative flex min-h-44 flex-col rounded-xl p-4"
                style={SETTINGS_SURFACE}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="grid size-9 place-items-center rounded-lg"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--c-border)",
                    }}
                  >
                    <Icon
                      className="size-4 text-secondary"
                      aria-hidden="true"
                    />
                  </span>
                  <Badge size="sm" color="gray" type="pill-color">
                    Planned
                  </Badge>
                </div>
                <div className="mt-auto pt-6">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-quaternary">
                    Launch requirement {item.step}
                  </p>
                  <h3 className="text-sm font-semibold text-primary">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-xs leading-5 text-tertiary">
                    {item.body}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="What extensions will unlock"
        description="Planned contribution areas once the extension platform becomes available."
      >
        <div className="grid gap-3 py-1 sm:grid-cols-2 xl:grid-cols-4">
          {PLANNED_CAPABILITIES.map((item) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="flex items-start gap-3 rounded-xl p-4"
                style={SETTINGS_SURFACE}
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-lg"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--c-border)",
                  }}
                >
                  <Icon className="size-4 text-quaternary" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-primary">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-tertiary">
                    {item.body}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </SettingsSection>

      <div
        className="flex items-start gap-3 rounded-xl px-4 py-3.5"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--c-border)",
        }}
        role="note"
      >
        <Lock01
          className="mt-0.5 size-4 shrink-0 text-quaternary"
          aria-hidden="true"
        />
        <p className="text-xs leading-5 text-tertiary">
          This page is informational only. Nothing can be installed, enabled,
          updated, or configured from here in the current version of Coretex.
        </p>
      </div>
    </div>
  );
};
