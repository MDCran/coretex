// @ts-nocheck
import { type FC, useEffect, useMemo, useRef, useState } from "react";
const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });
import {
    Activity,
    ActivityHeart,
    BankNote03,
    Bell01,
    BookOpen01,
    Briefcase01,
    Calendar,
    CheckDone01,
    CornerDownLeft,
    Home01,
    Monitor04,
    Moon01,
    MusicNote01,
    Plus,
    Scales01,
    SearchLg,
    Settings01,
    Sun,
    Users01,
} from "@untitledui/icons";
import { useTheme } from "@teispace/next-themes";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { isHrefEnabled, type AreaKey } from "@/lib/areas";
import { cx } from "@/utils/cx";

interface CommandMeta {
    id: string;
    label: string;
    group: string;
    icon: FC<{ className?: string }>;
    keywords?: string;
    href?: string;
    /** Module root used to hide the command when that area is turned off. */
    module?: string;
    action?: "theme-light" | "theme-dark" | "theme-system";
}

const NAV: CommandMeta[] = [
    { id: "nav-dashboard", label: "Dashboard", group: "Go to", icon: Home01, href: "/dashboard", keywords: "home overview" },
    { id: "nav-career", label: "Career", group: "Go to", icon: Briefcase01, href: "/career", keywords: "jobs applications pipeline" },
    { id: "nav-health", label: "Health", group: "Go to", icon: ActivityHeart, href: "/health", keywords: "habits vitals sleep" },
    { id: "nav-nutrition", label: "Nutrition", group: "Go to", icon: Scales01, href: "/nutrition", keywords: "food calories macros meals" },
    { id: "nav-workouts", label: "Workouts", group: "Go to", icon: Activity, href: "/workouts", keywords: "training gym lifts" },
    { id: "nav-music", label: "Music", group: "Go to", icon: MusicNote01, href: "/music", keywords: "spotify playlists" },
    { id: "nav-financial", label: "Financial", group: "Go to", icon: BankNote03, href: "/financial", keywords: "money net worth budget spending" },
    { id: "nav-social", label: "Social", group: "Go to", icon: Users01, href: "/social", keywords: "contacts relationships" },
    { id: "nav-learning", label: "Learning", group: "Go to", icon: BookOpen01, href: "/learning", keywords: "courses flashcards notes" },
    { id: "nav-calendar", label: "Calendar", group: "Go to", icon: Calendar, href: "/calendar", keywords: "events schedule reminders" },
    { id: "nav-todos", label: "To-dos", group: "Go to", icon: CheckDone01, href: "/todos", keywords: "tasks checklist" },
    { id: "nav-notifications", label: "Notifications", group: "Go to", icon: Bell01, href: "/notifications", keywords: "alerts inbox" },
    { id: "nav-settings", label: "Settings", group: "Go to", icon: Settings01, href: "/settings", keywords: "preferences account profile" },
];

const ACTIONS: CommandMeta[] = [
    { id: "act-application", label: "New job application", group: "Create", icon: Plus, href: "/career/applications/new", module: "/career", keywords: "add job" },
    { id: "act-contact", label: "Add a contact", group: "Create", icon: Plus, href: "/social/contacts/new", module: "/social", keywords: "person relationship" },
    { id: "act-workout", label: "Log a workout", group: "Create", icon: Plus, href: "/workouts/log", module: "/workouts", keywords: "training session" },
    { id: "act-meal", label: "Log a meal", group: "Create", icon: Plus, href: "/nutrition#nutrition-quick-log", module: "/nutrition", keywords: "food calories" },
    { id: "act-transaction", label: "Log a transaction", group: "Create", icon: Plus, href: "/financial/transactions", module: "/financial", keywords: "expense money" },
    { id: "act-event", label: "Open calendar", group: "Create", icon: Plus, href: "/calendar", module: "/calendar", keywords: "event reminder" },
];

const THEME: CommandMeta[] = [
    { id: "theme-light", label: "Switch to light mode", group: "Theme", icon: Sun, action: "theme-light", keywords: "appearance bright" },
    { id: "theme-dark", label: "Switch to dark mode", group: "Theme", icon: Moon01, action: "theme-dark", keywords: "appearance night" },
    { id: "theme-system", label: "Use system theme", group: "Theme", icon: Monitor04, action: "theme-system", keywords: "appearance auto os" },
];

const GROUP_ORDER = ["Go to", "Create", "Theme"];

export function CommandPalette({
    isOpen,
    onOpenChange,
    hiddenAreas = [],
}: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    hiddenAreas?: AreaKey[];
}) {
    const router = useRouter();
    const { setTheme } = useTheme();
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const close = () => onOpenChange(false);

    // All commands, gated by which areas the user tracks.
    const all = useMemo<CommandMeta[]>(() => {
        const navVisible = NAV.filter((c) => !c.href || isHrefEnabled(c.href, hiddenAreas));
        const actVisible = ACTIONS.filter((c) => !c.module || isHrefEnabled(c.module, hiddenAreas));
        return [...navVisible, ...actVisible, ...THEME];
    }, [hiddenAreas]);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matched = q
            ? all.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(q))
            : all;
        return matched;
    }, [all, query]);

    // Reset the highlighted row whenever the result set changes.
    useEffect(() => {
        setActive(0);
    }, [query, isOpen]);

    // Keep the active row in view.
    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${active}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [active]);

    function perform(cmd: CommandMeta) {
        close();
        if (cmd.href) {
            router.push(cmd.href);
        } else if (cmd.action === "theme-light") {
            setTheme("light");
        } else if (cmd.action === "theme-dark") {
            setTheme("dark");
        } else if (cmd.action === "theme-system") {
            setTheme("system");
        }
    }

    function onKeyDown(e: React.KeyboardEvent) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const cmd = results[active];
            if (cmd) perform(cmd);
        }
    }

    // Build group blocks while tracking the flat index used for keyboard nav.
    let flatIndex = -1;
    const groups = GROUP_ORDER.map((group) => ({
        group,
        items: results.filter((c) => c.group === group),
    })).filter((g) => g.items.length > 0);

    return (
        <ModalOverlay
            isDismissable
            isOpen={isOpen}
            onOpenChange={(open) => {
                onOpenChange(open);
                if (!open) setQuery("");
            }}
            className="items-start! pt-[12vh]"
        >
            <Modal className="w-full max-w-xl">
                <Dialog aria-label="Command palette" className="block">
                    <div className="overflow-hidden rounded-2xl bg-primary shadow-2xl ring-1 ring-secondary_alt">
                        {/* Search input */}
                        <div className="flex items-center gap-3 border-b border-secondary px-4">
                            <SearchLg className="size-5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                            <input
                                autoFocus
                                type="text"
                                role="combobox"
                                aria-expanded
                                aria-controls="command-list"
                                aria-activedescendant={results[active] ? `command-${active}` : undefined}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={onKeyDown}
                                placeholder="Search or jump to…"
                                className="w-full bg-transparent py-4 text-md text-primary outline-hidden placeholder:text-placeholder"
                            />
                            <kbd className="hidden shrink-0 rounded border border-secondary px-1.5 py-0.5 text-[11px] font-medium text-tertiary sm:block">Esc</kbd>
                        </div>

                        {/* Results */}
                        <div ref={listRef} id="command-list" role="listbox" aria-label="Commands" className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
                            {results.length === 0 ? (
                                <p className="px-3 py-10 text-center text-sm text-tertiary">No results for “{query}”.</p>
                            ) : (
                                groups.map((g) => (
                                    <div key={g.group} className="mb-1 last:mb-0">
                                        <p className="px-2 pt-2 pb-1 text-xs font-semibold tracking-wide text-quaternary uppercase">{g.group}</p>
                                        {g.items.map((cmd) => {
                                            flatIndex += 1;
                                            const index = flatIndex;
                                            const selected = index === active;
                                            const Icon = cmd.icon;
                                            return (
                                                <button
                                                    key={cmd.id}
                                                    type="button"
                                                    role="option"
                                                    id={`command-${index}`}
                                                    data-cmd-index={index}
                                                    aria-selected={selected}
                                                    onMouseMove={() => setActive(index)}
                                                    onClick={() => perform(cmd)}
                                                    className={cx(
                                                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition duration-75 ease-linear",
                                                        selected ? "bg-active" : "hover:bg-primary_hover",
                                                    )}
                                                >
                                                    <Icon className="size-4.5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                                    <span className="flex-1 truncate text-sm font-medium text-secondary">{cmd.label}</span>
                                                    {selected && <CornerDownLeft className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
