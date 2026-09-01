// @ts-nocheck
"use client";

// Coretex Relay — Assistants connection strip. Shows every AI backend ("assistant")
// an agent can connect to, with a live online / offline / checking status dot. This is
// the "connection" behind an agent: green when the provider is reachable and serving
// models, red when it's offline, amber while a probe is in flight. Click a chip to
// manage it in Settings → AI providers.

import {
  RefreshCcw01,
  Settings01,
  Terminal,
  Wifi,
  WifiOff,
} from "@untitledui/icons";
import type { ProviderConfigState, ProviderHealth } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { healthErrorLabel, providerLabel } from "../labels";
import { BrandLogo, PROVIDER_DOMAIN } from "../ui/brand-logo";
import {
  EXECUTABLE_CODING_ASSISTANT_IDS,
  codingAssistantReadyDetail,
  isCodingAssistantEnabled,
  isCodingAssistantReady,
  providerLogoDomain,
  providerShortBlurb,
} from "../provider-meta";
import type { CoretexActions, CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";

type Conn = "online" | "offline" | "checking";

function connOf(h?: ProviderHealth): Conn {
  if (!h) return "offline";
  if (h.status === "checking") return "checking";
  return h.healthy ? "online" : "offline";
}

const DOT: Record<Conn, string> = {
  online: "var(--c-success, #22c55e)",
  offline: "var(--c-error, #ef4444)",
  checking: "var(--c-warning, #f59e0b)",
};

/**
 * Compact row of provider chips with online/offline dots. Reused on the Agents view
 * (and anywhere agents' upstream connections matter). Renders nothing structural when
 * disconnected beyond a single "reconnect" hint so it never dominates the page.
 */
export const AgentConnectionStrip = ({
  state,
  actions,
  onNavigate,
}: {
  state: CoretexState;
  actions: CoretexActions;
  onNavigate?: (t: NavTarget) => void;
}) => {
  const health = state.health ?? [];
  const providers = state.settings?.aiProviders ?? [];
  const providerRows = (
    providers.length > 0
      ? providers
      : health.map(
          (item) =>
            ({ provider: item.provider, enabled: true }) as ProviderConfigState,
        )
  ).map((config) => ({
    config,
    health: health.find((item) => item.provider === config.provider),
  }));
  const harnesses = (state.settings?.codingAgents ?? []).filter(
    (item) =>
      EXECUTABLE_CODING_ASSISTANT_IDS.has(item.id) &&
      isCodingAssistantEnabled(state.settings!, item),
  );
  const onlineProviders = providerRows.filter(
    ({ config, health: item }) => config.enabled && connOf(item) === "online",
  ).length;
  const readyHarnesses = harnesses.filter((item) =>
    isCodingAssistantReady(
      state.settings!,
      item,
      health.find((entry) => entry.provider === item.provider),
    ),
  ).length;
  const online = onlineProviders + readyHarnesses;
  const total = providerRows.length + harnesses.length;
    const liveCodexSessions =
        state.providerSessions?.sessions?.filter(
            (session) => session.isLoaded && session.status === "active",
        ).length ?? 0;
  const toProviders = () =>
    onNavigate?.({ kind: "settings", page: "ai-providers" });

  return (
    <section
      className="rounded-xl p-3.5"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--c-border)",
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {online > 0 ? (
            <Wifi className="size-4 text-success-primary" />
          ) : (
            <WifiOff className="size-4 text-quaternary" />
          )}
          <h2 className="text-sm font-semibold text-primary">
            Models & runtimes
          </h2>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium text-tertiary"
            style={{ background: "var(--surface-2)" }}
          >
            {online}/{total} ready
          </span>
          {liveCodexSessions > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-secondary px-2 py-0.5 text-xs font-medium text-success-primary">
              <span className="size-1.5 rounded-full bg-success-solid" />
              {liveCodexSessions} live{" "}
              {liveCodexSessions === 1 ? "task" : "tasks"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            color="secondary"
            iconLeading={RefreshCcw01}
            onClick={() => actions.requestHealthCheck()}
          >
            Refresh
          </Button>
          {onNavigate && (
            <Button
              size="sm"
              color="link-color"
              iconLeading={Settings01}
              onClick={toProviders}
            >
              Manage
            </Button>
          )}
        </div>
      </div>

      {total === 0 ? (
        <button
          type="button"
          onClick={toProviders}
          disabled={!onNavigate}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition enabled:hover:border-primary"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--c-border)",
          }}
        >
          <WifiOff className="size-4 text-quaternary" />
          <p className="text-xs text-tertiary">
            No model connections yet. Add a cloud, subscription, or local
            provider in{" "}
            <span className="font-medium text-secondary">
              Settings → AI providers
            </span>
            .
          </p>
        </button>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {providerRows.map(({ config, health: h }) => {
              const conn = config.enabled ? connOf(h) : "offline";
              const sub =
                conn === "online"
                  ? `${Math.round(h?.latencyMs ?? 0)}ms · ${h?.models.length ?? 0} models`
                  : conn === "checking"
                    ? "Checking…"
                    : config.enabled
                      ? healthErrorLabel(h?.error)
                      : "Disabled";
              return (
                <button
                  key={config.provider}
                  type="button"
                  onClick={toProviders}
                  disabled={!onNavigate}
                  title={`${providerLabel(config.provider)} — ${providerShortBlurb(config.provider)}`}
                  className="group inline-flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition enabled:cursor-pointer enabled:hover:shadow-xs"
                  style={{
                    background: "var(--surface-2)",
                    border: `1px solid ${conn === "online" ? "color-mix(in srgb, var(--c-success, #22c55e) 40%, var(--c-border))" : "var(--c-border)"}`,
                    opacity: conn === "offline" ? 0.72 : 1,
                  }}
                >
                  <span className="relative">
                    <BrandLogo
                      domain={
                        PROVIDER_DOMAIN[config.provider] ?? config.provider
                      }
                      name={providerLabel(config.provider)}
                      size={24}
                    />
                    <span
                      aria-hidden
                      className={
                        conn === "checking"
                          ? "absolute -bottom-0.5 -right-0.5 size-2.5 animate-pulse rounded-full ring-2 ring-[var(--surface)]"
                          : "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--surface)]"
                      }
                      style={{ background: DOT[conn] }}
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-semibold leading-tight text-primary">
                      {providerLabel(config.provider)}
                    </span>
                    <span className="truncate text-[11px] leading-tight text-tertiary">
                      {sub}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {harnesses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-secondary pt-2.5">
              <span className="inline-flex items-center gap-1.5 pr-1 text-[11px] font-semibold tracking-wide text-quaternary uppercase">
                <Terminal className="size-3.5" />
                Coding runtimes
              </span>
              {harnesses.map((harness) => {
                const providerHealth = health.find(
                  (entry) => entry.provider === harness.provider,
                );
                const ready = isCodingAssistantReady(
                  state.settings!,
                  harness,
                  providerHealth,
                );
                return (
                  <button
                    key={harness.id}
                    type="button"
                    onClick={toProviders}
                    disabled={!onNavigate}
                    className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition enabled:hover:shadow-xs"
                    style={{
                      background: "var(--surface-2)",
                      border: `1px solid ${ready ? "color-mix(in srgb, var(--c-success, #22c55e) 40%, var(--c-border))" : "var(--c-border)"}`,
                    }}
                  >
                    <span className="relative">
                      <BrandLogo
                        domain={
                          harness.logoDomain ||
                          providerLogoDomain(harness.provider)
                        }
                        name={harness.name}
                        size={24}
                      />
                      <span
                        className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-[var(--surface)]"
                        style={{ background: ready ? DOT.online : DOT.offline }}
                      />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-xs font-semibold leading-tight text-primary">
                        {harness.name}
                      </span>
                      <span className="max-w-48 truncate text-[11px] leading-tight text-tertiary">
                        {codingAssistantReadyDetail(
                          state.settings!,
                          harness,
                          providerHealth,
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
