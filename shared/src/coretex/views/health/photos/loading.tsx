// @ts-nocheck
import { Skeleton } from "../_components/health-ui";

export default function Loading() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-6 w-44" />
                    <Skeleton className="h-4 w-64 max-w-full" />
                </div>
                <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
            <Skeleton className="h-4 w-48" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-3/4 rounded-xl" />
                ))}
            </div>
        </div>
    );
}
