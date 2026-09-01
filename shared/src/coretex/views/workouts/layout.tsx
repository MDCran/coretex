// @ts-nocheck
import type { ReactNode } from "react";
import { WorkoutsShell } from "./_components/workouts-shell";

export default function WorkoutsLayout({ children }: { children: ReactNode }) {
    return <WorkoutsShell>{children}</WorkoutsShell>;
}
