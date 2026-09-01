"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/utils/cx";

/** Simple client-side tabbed panel for the contact profile. */
export function ContactTabs({ tabs }: { tabs: { id: string; label: string; content: ReactNode }[] }) {
    const [active, setActive] = useState(tabs[0]?.id);
    const current = tabs.find((t) => t.id === active) ?? tabs[0];

    return (
        <div className="flex flex-col gap-6">
            <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-secondary">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActive(tab.id)}
                        className={cx(
                            "shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition duration-100 ease-linear",
                            tab.id === current?.id
                                ? "border-fg-brand-primary text-brand-secondary"
                                : "border-transparent text-tertiary hover:border-secondary hover:text-secondary",
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </nav>
            <div>{current?.content}</div>
        </div>
    );
}
