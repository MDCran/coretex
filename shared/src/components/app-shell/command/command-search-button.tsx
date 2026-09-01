// @ts-nocheck
import { SearchLg } from "@untitledui/icons";
import { useCommandPalette } from "./command-context";
import { cx } from "@/utils/cx";

/** Navbar search affordance that opens the command palette (also bound to ⌘K). */
export function CommandSearchButton({ className }: { className?: string }) {
    const { open } = useCommandPalette();
    return (
        <button
            type="button"
            onClick={open}
            aria-label="Search and commands (Command or Control + K)"
            className={cx(
                "flex h-10 items-center gap-2 rounded-lg px-2.5 text-fg-quaternary outline-focus-ring transition duration-100 ease-linear hover:bg-primary_hover hover:text-fg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 lg:bg-secondary_subtle lg:ring-1 lg:ring-secondary lg:ring-inset lg:hover:bg-secondary_hover",
                className,
            )}
        >
            <SearchLg className="size-5 shrink-0" aria-hidden="true" />
            <span className="hidden text-sm text-tertiary lg:inline">Search…</span>
            <kbd className="ml-2 hidden items-center rounded border border-secondary px-1.5 py-0.5 text-[11px] font-medium text-quaternary lg:inline-flex">⌘K</kbd>
        </button>
    );
}
