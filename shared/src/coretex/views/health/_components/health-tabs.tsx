// @ts-nocheck
import { cx } from "@/utils/cx";

/** Consistent underline tabs used across health sub-pages. */
export function HealthTabs<T extends string>({
    tabs,
    value,
    onChange,
}: {
    tabs: { id: T; label: string }[];
    value: T;
    onChange: (id: T) => void;
}) {
    return (
        <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-secondary" aria-label="Sections">
            {tabs.map((tab) => {
                const active = value === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(tab.id)}
                        className={cx(
                            "shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition duration-100 ease-linear outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2",
                            active ? "border-fg-brand-primary_alt text-brand-secondary" : "border-transparent text-tertiary hover:border-secondary hover:text-secondary",
                        )}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </nav>
    );
}
