// @ts-nocheck
import { RefreshCw02 } from "@untitledui/icons";
import { useTransition } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";


export function RefreshRatesButton() {
    const [pending, start] = useTransition();
    return (
        <Button
            color="secondary"
            size="sm"
            isLoading={pending}
            showTextWhileLoading
            iconLeading={<RefreshCw02 data-icon className="size-4" />}
            onClick={() =>
                start(async () => {
                    try {
                        const { count } = await refreshExchangeRates();
                        toast.success(`Updated ${count} exchange rates`);
                    } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Couldn't refresh rates.");
                    }
                })
            }
        >
            {pending ? "Refreshing…" : "Refresh rates"}
        </Button>
    );
}
