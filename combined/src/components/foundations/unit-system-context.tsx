"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { UnitSystem } from "@/lib/units";

/**
 * Server-seeded unit-system preference (METRIC | IMPERIAL). The (app) layout reads
 * `Settings.unitSystem` server-side and provides it here, so any client component can
 * read the user's preference via `useUnitSystem()` without prop drilling.
 *
 * This is additive: existing code that prop-passes `unitSystem` keeps working — new
 * code can opt into the hook instead. Defaults to IMPERIAL to match the schema default.
 */
const UnitSystemContext = createContext<UnitSystem>("IMPERIAL");

export function UnitSystemProvider({ value, children }: { value: UnitSystem; children: ReactNode }) {
    return <UnitSystemContext.Provider value={value}>{children}</UnitSystemContext.Provider>;
}

/** Read the user's preferred unit system. Returns 'IMPERIAL' | 'METRIC'. */
export function useUnitSystem(): UnitSystem {
    return useContext(UnitSystemContext);
}
