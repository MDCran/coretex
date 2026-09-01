import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fileUrl } from "@/lib/files";
import { PageHeader } from "@/components/jobs/page-header";
import { DraftsManager, type DraftItem, type DraftContact } from "@/components/social/drafts-manager";
import { createDraft, updateDraft, markDraftSent, archiveDraft, deleteDraft } from "@/lib/actions/social-drafts";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
    const user = await requireUser();

    const [drafts, contactRows] = await Promise.all([
        db.outreachDraft.findMany({
            where: { userId: user.id, archived: false },
            orderBy: [{ sentAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
            include: { contact: { select: { id: true, displayName: true, avatarKey: true } } },
        }),
        db.socialContact.findMany({
            where: { userId: user.id, active: true },
            orderBy: { displayName: "asc" },
            select: { id: true, displayName: true, avatarKey: true },
        }),
    ]);

    const contacts: DraftContact[] = contactRows.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        avatarKey: c.avatarKey,
        avatarUrl: c.avatarKey ? fileUrl(c.avatarKey) : null,
    }));

    const items: DraftItem[] = drafts.map((d) => ({
        id: d.id,
        contactId: d.contactId,
        contact: d.contact
            ? { id: d.contact.id, displayName: d.contact.displayName, avatarKey: d.contact.avatarKey, avatarUrl: d.contact.avatarKey ? fileUrl(d.contact.avatarKey) : null }
            : null,
        channel: d.channel,
        body: d.body,
        dueAt: d.dueAt ? d.dueAt.toISOString() : null,
        sentAt: d.sentAt ? d.sentAt.toISOString() : null,
    }));

    return (
        <div>
            <PageHeader title="Drafts" description="Write outreach ahead of time, set a deadline, and never miss the moment to reach out." />
            <DraftsManager
                drafts={items}
                contacts={contacts}
                actions={{
                    createAction: createDraft,
                    updateAction: updateDraft,
                    markSentAction: markDraftSent,
                    archiveAction: archiveDraft,
                    deleteAction: deleteDraft,
                }}
            />
        </div>
    );
}
