// @ts-nocheck
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WidgetId } from "@/components/app-shell/floating-widgets/widget-config";
import { WIDGET_DEFINITIONS } from "@/components/app-shell/floating-widgets/widget-config";
import { loadWidgetOpen, saveWidgetOpen } from "@/components/app-shell/floating-widgets/use-floating-widget";

interface FloatingWidgetsContextValue {
    openWidgets: Set<WidgetId>;
    isOpen: (id: WidgetId) => boolean;
    toggle: (id: WidgetId) => void;
    open: (id: WidgetId) => void;
    close: (id: WidgetId) => void;
    focusedId: WidgetId | null;
    focus: (id: WidgetId) => void;
}

const FloatingWidgetsContext = createContext<FloatingWidgetsContextValue | null>(null);

const FOCUS_KEY = "lifeos.widget.focused";

function loadFocused(): WidgetId | null {
    try {
        const raw = localStorage.getItem(FOCUS_KEY);
        if (raw && WIDGET_DEFINITIONS.some((d) => d.id === raw)) return raw as WidgetId;
    } catch {
        /* ignore */
    }
    return null;
}

function saveFocused(id: WidgetId | null) {
    try {
        if (id) localStorage.setItem(FOCUS_KEY, id);
        else localStorage.removeItem(FOCUS_KEY);
    } catch {
        /* ignore */
    }
}

export function FloatingWidgetsProvider({ children }: { children: ReactNode }) {
    const [openWidgets, setOpenWidgets] = useState<Set<WidgetId>>(() => new Set());
    const [hydrated, setHydrated] = useState(false);
    const [focusedId, setFocusedId] = useState<WidgetId | null>(null);

    useEffect(() => {
        const initial = new Set<WidgetId>();
        for (const def of WIDGET_DEFINITIONS) {
            if (loadWidgetOpen(def.id)) initial.add(def.id);
        }
        setOpenWidgets(initial);
        const storedFocus = loadFocused();
        // Only restore focus to a widget that is actually open.
        if (storedFocus && initial.has(storedFocus)) setFocusedId(storedFocus);
        setHydrated(true);
    }, []);

    const focus = useCallback((id: WidgetId) => {
        setFocusedId(id);
        saveFocused(id);
    }, []);

    const persist = useCallback((next: Set<WidgetId>) => {
        for (const def of WIDGET_DEFINITIONS) {
            saveWidgetOpen(def.id, next.has(def.id));
        }
    }, []);

    const toggle = useCallback(
        (id: WidgetId) => {
            const willOpen = !openWidgets.has(id);
            setOpenWidgets((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                persist(next);
                return next;
            });
            // Focus only when opening; focusing a widget we just closed would persist a
            // stale (closed) id as the focused widget.
            if (willOpen) focus(id);
            else if (id === focusedId) {
                setFocusedId(null);
                saveFocused(null);
            }
        },
        [openWidgets, focusedId, persist, focus],
    );

    const open = useCallback(
        (id: WidgetId) => {
            setOpenWidgets((prev) => {
                if (prev.has(id)) return prev;
                const next = new Set(prev);
                next.add(id);
                persist(next);
                return next;
            });
            focus(id);
        },
        [persist, focus],
    );

    const close = useCallback(
        (id: WidgetId) => {
            setOpenWidgets((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                persist(next);
                return next;
            });
            if (id === focusedId) {
                setFocusedId(null);
                saveFocused(null);
            }
        },
        [focusedId, persist],
    );

    const value = useMemo<FloatingWidgetsContextValue>(
        () => ({
            openWidgets: hydrated ? openWidgets : new Set(),
            isOpen: (id) => hydrated && openWidgets.has(id),
            toggle,
            open,
            close,
            focusedId,
            focus,
        }),
        [close, focus, focusedId, hydrated, open, openWidgets, toggle],
    );

    return <FloatingWidgetsContext.Provider value={value}>{children}</FloatingWidgetsContext.Provider>;
}

export function useFloatingWidgets() {
    const ctx = useContext(FloatingWidgetsContext);
    if (!ctx) throw new Error("useFloatingWidgets must be used within FloatingWidgetsProvider");
    return ctx;
}
