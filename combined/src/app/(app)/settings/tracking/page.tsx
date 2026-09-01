import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseHiddenAreas } from "@/lib/areas";
import { TrackingClient } from "@/components/settings/tracking-client";

export const dynamic = "force-dynamic";

export default async function SettingsTrackingPage() {
    const user = await requireUser();
    const settings = await db.settings.findUnique({ where: { userId: user.id }, select: { sidebarConfig: true } });
    const hidden = parseHiddenAreas(settings?.sidebarConfig);

    return <TrackingClient initialHidden={hidden} />;
}
