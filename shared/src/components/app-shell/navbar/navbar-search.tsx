// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });
import { SearchLg } from "@untitledui/icons";
import { cx } from "@/utils/cx";

type Dest = { label: string; href: string; group: string; keywords?: string };

/** Quick-jump destinations across the app (sections + key subpages). */
const DESTINATIONS: Dest[] = [
    { label: "Dashboard", href: "/dashboard", group: "Home" },
    { label: "Calendar", href: "/calendar", group: "Calendar" },
    { label: "Reminders", href: "/calendar/reminders", group: "Calendar" },
    { label: "To-dos", href: "/todos", group: "Productivity" },
    // Career
    { label: "Career overview", href: "/career", group: "Career" },
    { label: "Applications", href: "/career/applications", group: "Career", keywords: "jobs apply" },
    { label: "Job Search", href: "/career/search", group: "Career", keywords: "ai roles leads" },
    { label: "Companies", href: "/career/companies", group: "Career" },
    { label: "Contacts", href: "/career/contacts", group: "Career", keywords: "recruiter crm" },
    { label: "Offers", href: "/career/offers", group: "Career", keywords: "compensation comparison" },
    { label: "Interview prep", href: "/career/prep", group: "Career", keywords: "star questions" },
    { label: "Networking", href: "/career/networking", group: "Career", keywords: "outreach" },
    { label: "Career analytics", href: "/career/analytics", group: "Career", keywords: "response rate funnel" },
    { label: "Documents", href: "/career/documents", group: "Career", keywords: "resume cover letter" },
    { label: "Resume", href: "/career/resume", group: "Career" },
    { label: "Salary", href: "/career/salary", group: "Career", keywords: "compensation" },
    { label: "Skills", href: "/career/skills", group: "Career" },
    { label: "Career goals", href: "/career/goals", group: "Career", keywords: "targets" },
    // Financial
    { label: "Financial overview", href: "/financial", group: "Financial" },
    { label: "Accounts", href: "/financial/accounts", group: "Financial" },
    { label: "Transactions", href: "/financial/transactions", group: "Financial" },
    { label: "Budget", href: "/financial/budget", group: "Financial" },
    { label: "Cards", href: "/financial/cards", group: "Financial", keywords: "credit" },
    { label: "Credit score", href: "/financial/credit", group: "Financial" },
    { label: "Debt", href: "/financial/debt", group: "Financial" },
    { label: "Brokerage", href: "/financial/brokerage", group: "Financial", keywords: "investing stocks" },
    { label: "Subscriptions", href: "/financial/subscriptions", group: "Financial" },
    { label: "Statements", href: "/financial/statements", group: "Financial" },
    { label: "Income", href: "/financial/income", group: "Financial" },
    { label: "Net worth & planning", href: "/financial/planning", group: "Financial" },
    { label: "Tax", href: "/financial/tax", group: "Financial" },
    { label: "Institutions", href: "/financial/institutions", group: "Financial" },
    { label: "Financial goals", href: "/financial/goals", group: "Financial" },
    // Health
    { label: "Health overview", href: "/health", group: "Health" },
    { label: "Vitals", href: "/health/vitals", group: "Health" },
    { label: "Body metrics", href: "/health/metrics", group: "Health" },
    { label: "Medications", href: "/health/medications", group: "Health" },
    { label: "Peptides", href: "/health/peptides", group: "Health" },
    { label: "Nutrition", href: "/health/nutrition", group: "Health", keywords: "food calories" },
    { label: "Sleep", href: "/health/sleep", group: "Health" },
    { label: "Habits", href: "/health/habits", group: "Health" },
    { label: "Journal", href: "/health/journal", group: "Health" },
    { label: "Medical records", href: "/health/medical", group: "Health" },
    { label: "Sobriety", href: "/health/sobriety", group: "Health" },
    { label: "Progress photos", href: "/health/photos", group: "Health" },
    // Workouts
    { label: "Workouts", href: "/workouts", group: "Workouts", keywords: "gym lifting" },
    { label: "Exercises", href: "/workouts/exercises", group: "Workouts" },
    { label: "Templates", href: "/workouts/templates", group: "Workouts" },
    { label: "Schedule", href: "/workouts/schedule", group: "Workouts" },
    { label: "Body measurements", href: "/workouts/body", group: "Workouts" },
    // Learning
    { label: "Learning", href: "/learning", group: "Learning" },
    { label: "Courses", href: "/learning/courses", group: "Learning" },
    // Social
    { label: "Social", href: "/social", group: "Social" },
    { label: "Social contacts", href: "/social/contacts", group: "Social" },
    { label: "Social events", href: "/social/events", group: "Social" },
    // Music + settings
    { label: "Music", href: "/music", group: "Music" },
    { label: "Settings", href: "/settings", group: "Settings" },
    { label: "Integrations", href: "/settings/integrations", group: "Settings" },
    { label: "AI & usage", href: "/settings/ai", group: "Settings" },
];

/** Centered command-palette style quick search in the top navbar. */
export function NavbarSearch() {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return DESTINATIONS.filter((d) => `${d.label} ${d.group} ${d.keywords ?? ""}`.toLowerCase().includes(q)).slice(0, 8);
    }, [query]);

    useEffect(() => setActive(0), [query]);

    // ⌘K / Ctrl+K focuses the search from anywhere.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                inputRef.current?.focus();
            }
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    function go(href: string) {
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
        router.push(href);
    }

    return (
        <div ref={boxRef} className="relative w-full max-w-md">
            <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 ring-1 ring-secondary ring-inset transition focus-within:bg-primary focus-within:ring-2 focus-within:ring-brand">
                <SearchLg className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 120)}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setActive((i) => Math.min(i + 1, results.length - 1));
                        } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setActive((i) => Math.max(i - 1, 0));
                        } else if (e.key === "Enter" && results[active]) {
                            e.preventDefault();
                            go(results[active].href);
                        } else if (e.key === "Escape") {
                            setOpen(false);
                            inputRef.current?.blur();
                        }
                    }}
                    placeholder="Search LifeOS…"
                    aria-label="Search"
                    className="w-full bg-transparent py-2 text-sm text-primary outline-hidden placeholder:text-placeholder"
                />
                <kbd className="hidden shrink-0 rounded border border-secondary px-1.5 py-0.5 font-mono text-[10px] text-quaternary sm:block">⌘K</kbd>
            </div>

            {open && results.length > 0 && (
                <ul className="absolute left-0 top-full z-50 mt-1.5 max-h-80 w-full overflow-auto rounded-xl bg-primary py-1 shadow-lg ring-1 ring-secondary_alt">
                    {results.map((d, i) => (
                        <li key={d.href}>
                            <button
                                type="button"
                                // mousedown fires before the input's blur, so the click lands.
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    go(d.href);
                                }}
                                onMouseEnter={() => setActive(i)}
                                className={cx(
                                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition",
                                    i === active ? "bg-primary_hover" : "hover:bg-primary_hover",
                                )}
                            >
                                <span className="truncate text-sm font-medium text-primary">{d.label}</span>
                                <span className="shrink-0 text-xs text-quaternary">{d.group}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {open && query.trim() && results.length === 0 && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-full rounded-xl bg-primary px-3 py-3 text-sm text-tertiary shadow-lg ring-1 ring-secondary_alt">
                    No matches for “{query.trim()}”.
                </div>
            )}
        </div>
    );
}
