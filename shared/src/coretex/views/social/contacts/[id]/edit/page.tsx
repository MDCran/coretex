// @ts-nocheck





import { PageHeader } from "@/components/jobs/page-header";
import { ContactForm } from "@/components/social/contact-form";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await requireUser();
    const [contact, tags] = await Promise.all([
        db.socialContact.findFirst({ where: { id, userId: user.id }, include: { tags: { select: { id: true } } } }),
        db.socialTag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    ]);
    if (!contact) notFound();

    const action = updateContact.bind(null, contact.id);

    return (
        <div className="mx-auto max-w-3xl">
            <PageHeader title={`Edit ${contact.displayName}`} description="Update profile details and tags." />
            <ContactForm
                action={action}
                submitLabel="Save changes"
                cancelHref={`/social/contacts/${contact.id}`}
                tags={tags}
                createTagAction={createTagReturning}
                selectedTagIds={contact.tags.map((t) => t.id)}
                defaults={{
                    displayName: contact.displayName,
                    firstName: contact.firstName,
                    lastName: contact.lastName,
                    nickname: contact.nickname,
                    relationshipType: contact.relationshipType,
                    howWeMet: contact.howWeMet,
                    birthday: contact.birthday,
                    occupation: contact.occupation,
                    companyOrSchool: contact.companyOrSchool,
                    hometown: contact.hometown,
                    timezone: contact.timezone,
                    pronouns: contact.pronouns,
                    interests: contact.interests,
                    notes: contact.notes,
                    closenessScore: contact.closenessScore,
                    trustScore: contact.trustScore,
                    communicationFrequency: contact.communicationFrequency,
                    energyTags: contact.energyTags,
                    innerCircle: contact.innerCircle,
                    stayInTouch: contact.stayInTouch,
                    stayInTouchDays: contact.stayInTouchDays,
                    preferredContactMethod: contact.preferredContactMethod,
                    active: contact.active,
                    avatarUrl: contact.avatarKey ? fileUrl(contact.avatarKey) : null,
                }}
            />
        </div>
    );
}
