import { useCallback, useMemo, useState } from "react";

/**
 * Row-selection state for bulk-action tables. Tracks a set of selected ids and derives
 * a `ids` list filtered to those still present (so it stays correct after the list
 * re-renders post-action), plus select-all / indeterminate helpers.
 */
export function useRowSelection(allIds: string[]) {
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const ids = useMemo(() => allIds.filter((id) => selected.has(id)), [allIds, selected]);

    const toggle = useCallback((id: string, on: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (on) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const toggleAll = useCallback((on: boolean) => setSelected(on ? new Set(allIds) : new Set()), [allIds]);
    const clear = useCallback(() => setSelected(new Set()), []);

    const count = ids.length;
    const allOn = allIds.length > 0 && count === allIds.length;
    const someOn = count > 0 && !allOn;

    return { isSelected: (id: string) => selected.has(id), ids, count, toggle, toggleAll, clear, allOn, someOn };
}
