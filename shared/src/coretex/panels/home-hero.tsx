// @ts-nocheck
"use client";

// Coretex — Home hero. A vivid on-brand (RED→rose→orange) gradient banner that leads the
// global dashboard with a live status line + primary CTAs. Dismissible once the workspace
// is set up; always shown on a fresh (zero-state) workspace to drive onboarding.

import { useEffect, useState } from "react";
import { Zap, Plus, ArrowRight, XClose, PlayCircle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import type { NavTarget } from "../nav";
import { requestTour } from "../ui/tour";

const DISMISS_KEY = "coretex-hero-dismissed";

export const HomeHero = ({
  projectCount,
  agentCount,
  onNavigate,
}: {
  projectCount: number;
  agentCount: number;
  onNavigate?: (t: NavTarget) => void;
}) => {
  const fresh = projectCount === 0 && agentCount === 0;
  const [dismissed, setDismissed] = useState(true);

  // Hydrate dismiss state; a fresh workspace ignores dismissal (onboarding).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (dismissed && !fresh) return null;

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined")
      window.localStorage.setItem(DISMISS_KEY, "1");
  };

  return (
    <div
      className="relative isolate overflow-hidden rounded-xl p-4 shadow-xl sm:rounded-2xl sm:p-6 lg:p-8"
      style={{
        background:
          "linear-gradient(120deg, #ef4242 0%, #e11d48 46%, #f97316 100%)",
        border: "1px solid color-mix(in srgb, #fff 18%, transparent)",
      }}
    >
      {/* Decorative blooms + grid for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(255,255,255,0.6), transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 left-1/3 size-72 rounded-full opacity-25 blur-3xl"
        style={{
          background: "radial-gradient(circle, #fde68a, transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Oversized brand mark — faint white, rotated, bleeding off the right edge for a printed-illustration feel. */}
      <img
        aria-hidden
        src="./coretex-icon.svg"
        alt=""
        className="pointer-events-none absolute -right-16 -bottom-20 hidden w-[28rem] max-w-none select-none sm:block"
        style={{
          filter: "brightness(0) invert(1)",
          opacity: 0.09,
          transform: "rotate(-16deg)",
        }}
      />

      {/* Dismiss */}
      {!fresh && (
        <button
          type="button"
          onClick={dismiss}
          title="Dismiss"
          className="absolute top-3 right-3 z-10 rounded-lg p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white"
        >
          <XClose className="size-4" />
        </button>
      )}

      <div className="relative flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 max-w-2xl">
          <span
            className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-2.5 py-1 text-xs font-semibold text-white"
            style={{
              background: "rgba(255,255,255,0.16)",
              border: "1px solid rgba(255,255,255,0.22)",
            }}
          >
            <span className="relative flex size-1.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-white" />
            </span>
            <span className="truncate">
              {fresh
                ? "Welcome to Coretex"
                : `Live · ${agentCount} agent${agentCount === 1 ? "" : "s"} · ${projectCount} project${projectCount === 1 ? "" : "s"}`}
            </span>
          </span>

          <h1 className="mt-2 text-xl font-semibold tracking-tight text-white sm:mt-3 sm:text-2xl lg:text-3xl">
            {fresh
              ? "Build your AI agent workspace"
              : "Your AI workspace, at a glance"}
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-white/85 sm:text-base">
            {fresh
              ? "Deploy autonomous agents, plan and run work, and orchestrate terminals, servers, and keys — all in one place."
              : "Spin up agents, route work through councils, and keep an eye on cost, providers, and running infrastructure."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5 sm:gap-2.5">
            <Button
              size="md"
              color="secondary"
              iconLeading={Zap}
              onClick={() => onNavigate?.({ kind: "agents" })}
            >
              Deploy an agent
            </Button>
            <button
              type="button"
              onClick={() => onNavigate?.({ kind: "projects" })}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15 sm:px-3.5 sm:py-2.5"
              style={{
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.28)",
              }}
            >
              <Plus className="size-4" /> New project
            </button>
            <button
              type="button"
              onClick={requestTour}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-white/85 transition hover:text-white sm:px-2.5 sm:py-2.5"
            >
              <PlayCircle className="size-4" /> Take the tour{" "}
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Glassy emblem */}
        <div aria-hidden className="hidden shrink-0 lg:block">
          <div
            className="flex size-24 items-center justify-center rounded-3xl"
            style={{
              background: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.28)",
              backdropFilter: "blur(6px)",
            }}
          >
            <img
              src="./coretex-icon.svg"
              alt=""
              className="size-12 drop-shadow"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
