import { Plus } from "@untitledui/icons";
import { subDays } from "date-fns";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fileUrl } from "@/lib/files";
import { Button } from "@/components/base/buttons/button";
import { PageHeader } from "@/components/jobs/page-header";
import { ContactsDirectory, type DirectoryContact } from "@/components/social/contacts-directory";
import { createTag, updateTag, deleteTag } from "@/lib/actions/social-tags";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
    const user = await requireUser();
    const since = subDays(new Date(), 90);
    const [contacts, tags] = await Promise.all([
        db.socialContact.findMany({
            where: { userId: user.id },
            orderBy: { displayName: "asc" },
            include: {
                tags: { select: { id: true, name: true, color: true } },
                interactions: { where: { date: { gte: since } }, select: { date: true } },
                communications: { where: { date: { gte: since } }, select: { date: true } },
            },
        }),
        db.socialTag.findMany({
            where: { userId: user.id },
            orderBy: { name: "asc" },
            include: { _count: { select: { contacts: true } } },
        }),
    ]);

    const data: DirectoryContact[] = contacts.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        relationshipType: c.relationshipType,
        occupation: c.occupation,
        closenessScore: c.closenessScore,
        trustScore: c.trustScore,
        innerCircle: c.innerCircle,
        active: c.active,
        avatarUrl: c.avatarKey ? fileUrl(c.avatarKey) : null,
        timezone: c.timezone,
        lastContactAt: c.lastContactAt ? c.lastContactAt.toISOString() : null,
        stayInTouch: c.stayInTouch,
        stayInTouchDays: c.stayInTouchDays,
        energyTags: c.energyTags,
        tags: c.tags,
        activityDates: [...c.interactions, ...c.communications].map((x) => x.date.toISOString()),
    }));

    const tagRows = tags.map((t) => ({ id: t.id, name: t.name, color: t.color, count: t._count.contacts }));

    return (
        <div>
            <PageHeader title="Contacts" description={`${contacts.length} ${contacts.length === 1 ? "person" : "people"} in your network`}>
                <Button href="/social/contacts/new" color="primary" iconLeading={<Plus data-icon className="size-4" />}>
                    Add contact
                </Button>
            </PageHeader>
            <ContactsDirectory contacts={data} tags={tagRows} createTagAction={createTag} updateTagAction={updateTag} deleteTagAction={deleteTag} />
        </div>
    );
}
