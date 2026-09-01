// @ts-nocheck
import { X, Stars02 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { useAiActivity } from "@/components/app-shell/floating-widgets/ai-activity-context";

/**
 * Compact glassy card pinned bottom-right (above the widget dock). It renders only
 * while AI operations are in flight — manual ops registered via useAiActivity().begin
 * and any running job-search runs auto-detected by the provider's poller.
 */
export function AiActivityWidget() {
    const { activities, haltRun } = useAiActivity();
    const visible = activities.length > 0;

    return (
        <div
            aria-hidden={!visible}
            className={cx(
                "fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(max(1rem,env(safe-area-inset-bottom))+4.5rem)] z-[100] flex justify-end",
                visible ? "pointer-events-auto" : "pointer-events-none",
            )}
        >
            <div
                role="status"
                aria-live="polite"
                className={cx(
                    "w-64 origin-bottom-right rounded-xl bg-primary/90 p-3 shadow-lg ring-1 ring-secondary backdrop-blur-md transition-all duration-200 ease-out",
                    "dark:bg-primary/90 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06),0_16px_40px_-12px_rgb(0_0_0/0.7)]",
                    "motion-reduce:transition-none",
                    visible
                        ? "translate-y-0 scale-100 opacity-100"
                        : "pointer-events-none translate-y-2 scale-95 opacity-0 motion-reduce:transform-none",
                )}
            >
                <div className="flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-secondary">
                        <Stars02 className="size-3.5 text-fg-brand-primary animate-pulse motion-reduce:animate-none" aria-hidden="true" />
                    </span>
                    <span className="text-sm font-semibold text-primary">AI working…</span>
                </div>

                <ul className="mt-2.5 flex flex-col gap-2.5">
                    {activities.map((op) => {
                        const determinate = typeof op.progress === "number";
                        const pct = determinate ? Math.max(0, Math.min(100, op.progress as number)) : 0;
                        const isJobRun = op.id.startsWith("job-search:");
                        return (
                            <li key={op.id} className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary" title={op.label}>
                                        {op.label}
                                    </span>
                                    {isJobRun && (
                                        <button
                                            type="button"
                                            aria-label="Halt this job search"
                                            onClick={() => void haltRun(op.id)}
                                            className="flex size-5 shrink-0 items-center justify-center rounded-md text-fg-quaternary transition duration-100 ease-linear hover:bg-error-primary/10 hover:text-error-primary"
                                        >
                                            <X className="size-3.5" aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                                <span className="h-1.5 w-full overflow-hidden rounded-full bg-quaternary">
                                    <span
                                        className={cx(
                                            "block h-full rounded-full bg-brand-solid transition-[width] duration-500 ease-out motion-reduce:transition-none",
                                            !determinate && "w-2/5 animate-pulse motion-reduce:animate-none motion-reduce:w-full",
                                        )}
                                        style={determinate ? { width: `${pct}%` } : undefined}
                                    />
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
