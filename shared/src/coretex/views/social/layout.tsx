// @ts-nocheck
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { db } from "@/lib/db";
import { ReactNode } from "react";
import { SocialQuickActions } from "./social-hub-actions";
import { SocialSubNav } from "./sub-nav";



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
