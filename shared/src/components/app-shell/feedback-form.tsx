// @ts-nocheck
import { useState } from "react";
import { Lightbulb02, MessageSmileSquare, Send01, Tool01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { submitFeedback, type FeedbackCategory } from "@/lib/actions/feedback";
import { cx } from "@/utils/cx";

const CATEGORIES: { id: FeedbackCategory; label: string; icon: typeof Lightbulb02 }[] = [
    { id: "idea", label: "Idea", icon: Lightbulb02 },
    { id: "bug", label: "Bug", icon: Tool01 },
    { id: "praise", label: "Praise", icon: MessageSmileSquare },
];

export function FeedbackForm() {
    const [category, setCategory] = useState<FeedbackCategory>("idea");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);

    async function onSubmit() {
        if (!message.trim() || busy) return;
        setBusy(true);
        try {
            await submitFeedback({ message: message.trim(), category });
            toast.success("Thanks for the feedback!");
            setMessage("");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't send feedback");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(({ id, label, icon: Icon }) => {
                    const selected = category === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setCategory(id)}
                            aria-pressed={selected}
                            className={cx(
                                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition duration-100 ease-linear",
                                selected ? "bg-brand-primary text-brand-secondary ring-brand" : "text-tertiary ring-secondary hover:bg-secondary_hover",
                            )}
                        >
                            <Icon className="size-4" aria-hidden="true" />
                            {label}
                        </button>
                    );
                })}
            </div>
            <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="What's on your mind? Ideas, bugs, anything…"
                aria-label="Your feedback"
                className="w-full resize-none rounded-lg bg-primary px-3 py-2.5 text-sm text-primary shadow-xs ring-1 ring-primary ring-inset transition placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
            />
            <div className="flex justify-end">
                <Button onClick={onSubmit} isDisabled={!message.trim()} isLoading={busy} showTextWhileLoading iconLeading={Send01}>
                    Send feedback
                </Button>
            </div>
        </div>
    );
}
