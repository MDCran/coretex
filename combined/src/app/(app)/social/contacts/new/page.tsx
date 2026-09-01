import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createContact } from "@/lib/actions/social-contacts";
import { createTagReturning } from "@/lib/actions/social-tags";
import { PageHeader } from "@/components/jobs/page-header";
import { ContactForm } from "@/components/social/contact-form";

export const dynamic = "force-dynamic";

export default async function NewContactPage() {
    const user = await requireUser();
    const tags = await db.socialTag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } });
    return (
        <div className="mx-auto max-w-3xl">
            <PageHeader title="Add contact" description="Add someone to your network." />
            <ContactForm action={createContact} submitLabel="Create contact" cancelHref="/social/contacts" tags={tags} createTagAction={createTagReturning} />
        </div>
    );
}
