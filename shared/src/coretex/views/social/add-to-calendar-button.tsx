// @ts-nocheck

import { useState } from "react";
import { toast } from "sonner";
import { CalendarPlus01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";

type Action = (formData: FormData) => Promise<void>;

/** One-click "Add to calendar" for a contact date. Creates an all-day event. */
export function AddToCalendarButton({ id, action }: { id: string; action: Action }) {
    const [loading, setLoading] = useState(false);

    async function run() {
        setLoading(true);
        const fd = new FormData();
        fd.set("id", id);
        try {
            await action(fd);
            toast.success("Added to calendar");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to add");
        } finally {
            setLoading(false);
        }
    }

    return (
        <Button color="tertiary" size="sm" iconLeading={CalendarPlus01} isLoading={loading} onClick={run} aria-label="Add to calendar">
            Calendar
        </Button>
    );
}
