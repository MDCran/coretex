import type { JobStatus } from "@prisma/client";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { STATUS_LABELS, STATUS_BADGE_COLOR } from "@/lib/jobs/enums";

export function StatusBadge({ status, size = "sm" }: { status: JobStatus; size?: "sm" | "md" | "lg" }) {
    return (
        <BadgeWithDot color={STATUS_BADGE_COLOR[status]} type="pill-color" size={size}>
            {STATUS_LABELS[status]}
        </BadgeWithDot>
    );
}
