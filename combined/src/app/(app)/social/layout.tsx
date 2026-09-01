import type { ReactNode } from "react";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { SocialSubNav } from "@/components/social/sub-nav";
import { SocialQuickActions } from "@/components/social/social-hub-actions";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export default async function SocialLayout({ children }: { children: ReactNode }) {
    const user = await requireUser();
    const contacts = await db.socialContact.findMany({
        where: { userId: user.id, active: true },
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
    });

    return (
        <ModulePageShell
            title="Social"
            description="Relationships, interactions, events and your social battery."
            actions={<SocialQuickActions contacts={contacts} />}
            nav={<SocialSubNav />}
        >
            {children}
        </ModulePageShell>
    );
}
