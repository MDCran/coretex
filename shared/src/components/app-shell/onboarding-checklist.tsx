// @ts-nocheck
import { useEffect, useState } from "react";

import { ArrowRight, CheckCircle, Circle, Rocket01, X as XIcon } from "@untitledui/icons";
import type { OnboardingStep } from "@/lib/onboarding";
import { cx } from "@/utils/cx";

const DISMISS_KEY = "lifeos.onboarding.dismissed";

/** Activation checklist with progress. Hidden once complete or dismissed (per device). */
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
    const [mounted, setMounted] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        setMounted(true);
        try {
            setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
        } catch {
            /* ignore */
        }
    }, []);

    const done = steps.filter((s) => s.done).length;
    const total = steps.length;
    const allDone = done === total;

    // Avoid SSR/client flash; hide when complete or dismissed.
    if (!mounted || dismissed || allDone) return null;

    const pct = Math.round((done / total) * 100);

    function dismiss() {
        try {
            localStorage.setItem(DISMISS_KEY, "1");
        } catch {
            /* ignore */
        }
        setDismissed(true);
    }

    return (
        <div className="relative overflow-hidden rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset sm:p-6">
            <div
                className="pointer-events-none absolute -top-16 -right-12 size-48 rounded-full opacity-40 blur-3xl"
                style={{ background: "radial-gradient(circle, rgb(127 86 217 / 0.4), transparent 70%)" }}
                aria-hidden="true"
            />
            <div className="relative">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-primary text-brand-secondary ring-1 ring-brand ring-inset">
                            <Rocket01 className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <p className="text-md font-semibold text-primary">Get set up</p>
                            <p className="text-sm text-tertiary">{done} of {total} done — finish setting up LifeOS.</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Dismiss setup checklist"
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-quaternary transition hover:bg-primary_hover hover:text-fg-secondary"
                    >
                        <XIcon className="size-4.5" aria-hidden="true" />
                    </button>
                </div>

                {/* Progress bar */}
                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-quaternary">
                    <div className="h-full rounded-full bg-brand-solid transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
                </div>

                {/* Steps */}
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {steps.map((step) => (
                        <li key={step.id}>
                            {step.done ? (
                                <div className="flex items-center gap-2.5 rounded-xl bg-secondary_subtle px-3 py-2.5 ring-1 ring-secondary ring-inset">
                                    <CheckCircle className="size-5 shrink-0 text-success-primary" aria-hidden="true" />
                                    <span className="text-sm font-medium text-tertiary line-through">{step.label}</span>
                                </div>
                            ) : (
                                <a href="#">
                                    <Circle className="size-5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-semibold text-primary">{step.label}</span>
                                        <span className="block truncate text-xs text-tertiary">{step.description}</span>
                                    </span>
                                    <ArrowRight className="size-4 shrink-0 text-fg-quaternary transition-transform duration-100 ease-linear group-hover:translate-x-0.5" aria-hidden="true" />
                                </a>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
