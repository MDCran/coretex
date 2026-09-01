// @ts-nocheck
import { useState } from "react";
import { toast } from "sonner";
import { Check, ClockFastForward } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

const CADENCES = [1, 3, 7, 30];

/**
 * One/two-click reach-out controls for a contact.
 * - Cadence chips (1d / 3d / 7d / 30d) enable stay-in-touch and set the interval.
 * - "Mark reached out" logs a reach-out interaction (updates lastContactAt).
 *
 * Server actions are passed in (FormData-based) so this stays a client island.
 */
export function ReachOutActions({
    contactId,
    scheduleAction,
    markAction,
    layout = "inline",
}: {
    contactId: string;
    scheduleAction: (formData: FormData) => Promise<void>;
    markAction: (formData: FormData) => Promise<void>;
    layout?: "inline" | "stacked";
}) {
    const [pending, setPending] = useState<string | null>(null);

    async function schedule(days: number) {
        setPending(`s${days}`);
        try {
            const fd = new FormData();
            fd.set("id", contactId);
            fd.set("days", String(days));
            await scheduleAction(fd);
            toast.success(`Reach-out scheduled every ${days}d`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to schedule");
        } finally {
            setPending(null);
        }
    }

    async function mark() {
        setPending("mark");
        try {
            const fd = new FormData();
            fd.set("id", contactId);
            await markAction(fd);
            toast.success("Marked reached out");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to update");
        } finally {
            setPending(null);
        }
    }

    return (
        <div className={cx("flex gap-2", layout === "stacked" ? "flex-col items-stretch" : "flex-wrap items-center")}>
            <Button
                color="primary"
                size="sm"
                iconLeading={<Check data-icon className="size-4" />}
                isLoading={pending === "mark"}
                showTextWhileLoading
                onClick={mark}
            >
                Mark reached out
            </Button>
            <div className="flex items-center gap-1.5">
                <ClockFastForward className="size-4 text-fg-quaternary" aria-hidden="true" />
                {CADENCES.map((d) => (
                    <Button
                        key={d}
                        color="secondary"
                        size="sm"
                        isLoading={pending === `s${d}`}
                        showTextWhileLoading
                        onClick={() => schedule(d)}
                    >
                        {d}d
                    </Button>
                ))}
            </div>
        </div>
    );
}
