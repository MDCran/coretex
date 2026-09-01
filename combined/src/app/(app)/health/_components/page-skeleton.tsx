import { CardSkeleton, Skeleton } from "./health-ui";

/**
 * Tasteful page-level loading skeleton shared by Health route `loading.tsx`
 * files so navigation between sub-pages feels instant instead of blank.
 */
export function HealthPageSkeleton({ cards = 2, withChart = true }: { cards?: number; withChart?: boolean }) {
    return (
        <div className="flex flex-col gap-6">
            {/* Section header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-6 w-44" />
                    <Skeleton className="h-4 w-72 max-w-full" />
                </div>
                <Skeleton className="h-10 w-32 rounded-lg" />
            </div>

            {withChart && (
                <div className="rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="mt-4 h-56 w-full rounded-lg" />
                </div>
            )}

            <div className="flex flex-col gap-4">
                {Array.from({ length: cards }).map((_, i) => (
                    <CardSkeleton key={i} lines={i % 2 === 0 ? 3 : 2} />
                ))}
            </div>
        </div>
    );
}
