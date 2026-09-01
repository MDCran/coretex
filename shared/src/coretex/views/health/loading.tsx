// @ts-nocheck
import { CardSkeleton, Skeleton } from "./_components/health-ui";

export default function Loading() {
    return (
        <div className="flex flex-col gap-6">
            {/* Hero */}
            <Skeleton className="h-40 w-full rounded-2xl" />
            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
            </div>
            {/* Action cards */}
            <div className="grid gap-6 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <CardSkeleton key={i} lines={3} />
                ))}
            </div>
        </div>
    );
}
