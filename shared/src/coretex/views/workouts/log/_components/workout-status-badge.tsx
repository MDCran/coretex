// @ts-nocheck
import { CheckCircle, Clock } from "@untitledui/icons";
import { BadgeWithIcon } from "@/components/base/badges/badges";

export function WorkoutStatusBadge({ ended }: { ended: boolean }) {
    if (ended) {
        return (
            <BadgeWithIcon color="success" size="sm" iconLeading={CheckCircle}>
                Done
            </BadgeWithIcon>
        );
    }

    return (
        <BadgeWithIcon color="warning" size="sm" iconLeading={Clock}>
            In progress
        </BadgeWithIcon>
    );
}
