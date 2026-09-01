import { redirect } from "next/navigation";

/**
 * Metrics merged into the unified "Body & Metrics" tab. This route is kept as a
 * permanent redirect so existing links/bookmarks continue to work.
 */
export default function MetricsPage() {
    redirect("/workouts/body");
}
