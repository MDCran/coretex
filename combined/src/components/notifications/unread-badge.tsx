import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cx } from "@/utils/cx";

/**
 * Server component showing the count of unread notifications.
 * Drop it next to a "Notifications" nav item in the shell, e.g.
 *   <UnreadBadge />
 * Renders nothing when there are no unread notifications.
 */
export async function UnreadBadge({ className }: { className?: string }) {
    const user = await getCurrentUser();
    if (!user) return null;

    const count = await db.notification.count({ where: { userId: user.id, readAt: null } });
    if (count === 0) return null;

    return (
        <span
            className={cx(
                "inline-flex min-w-5 items-center justify-center rounded-full bg-error-solid px-1.5 py-0.5 text-xs font-semibold text-white",
                className,
            )}
        >
            {count > 99 ? "99+" : count}
        </span>
    );
}

export default UnreadBadge;
