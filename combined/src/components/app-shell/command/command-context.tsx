"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { CommandPalette } from "./command-palette";
import type { AreaKey } from "@/lib/areas";

interface CommandPaletteApi {
    open: () => void;
    close: () => void;
    toggle: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteApi | null>(null);

/** Trigger the global command palette from anywhere under the provider. */
export function useCommandPalette(): CommandPaletteApi {
    return useContext(CommandPaletteContext) ?? { open: () => {}, close: () => {}, toggle: () => {} };
}

export function CommandPaletteProvider({ hiddenAreas, children }: { hiddenAreas: AreaKey[]; children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);

    const api = useMemoApi(setIsOpen);

    // Global ⌘K / Ctrl+K shortcut.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setIsOpen((o) => !o);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <CommandPaletteContext.Provider value={api}>
            {children}
            <CommandPalette isOpen={isOpen} onOpenChange={setIsOpen} hiddenAreas={hiddenAreas} />
        </CommandPaletteContext.Provider>
    );
}

function useMemoApi(setIsOpen: (updater: boolean | ((o: boolean) => boolean)) => void): CommandPaletteApi {
    const open = useCallback(() => setIsOpen(true), [setIsOpen]);
    const close = useCallback(() => setIsOpen(false), [setIsOpen]);
    const toggle = useCallback(() => setIsOpen((o) => !o), [setIsOpen]);
    return { open, close, toggle };
}
