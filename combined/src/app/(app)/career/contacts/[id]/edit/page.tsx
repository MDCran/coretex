import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/jobs/page-header";
import { ContactForm } from "@/components/jobs/contact-form";
import { updateContact } from "@/lib/actions/jobs-contacts";
import { companyOptions } from "@/lib/jobs/queries";

export const dynamic = "force-dynamic";

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser();
    const { id } = await params;
    const [contact, companies] = await Promise.all([db.jobContact.findFirst({ where: { id, userId: user.id } }), companyOptions(user.id)]);
    if (!contact) notFound();

    return (
        <div className="w-full">
            <PageHeader title={`Edit ${contact.name}`} />
            <ContactForm
                action={updateContact.bind(null, id)}
                companies={companies.map((c) => ({ id: c.id, name: c.name }))}
                cancelHref={`/career/contacts/${id}`}
                submitLabel="Save changes"
                defaults={{
                    name: contact.name,
                    companyId: contact.companyId,
                    role: contact.role,
                    kind: contact.kind,
                    preferredContactMethod: contact.preferredContactMethod,
                    email: contact.email,
                    phone: contact.phone,
                    linkedinUrl: contact.linkedinUrl,
                    discord: contact.discord,
                    pronouns: contact.pronouns,
                    location: contact.location,
                    timezone: contact.timezone,
                    notesMarkdown: contact.notesMarkdown,
                }}
            />
        </div>
    );
}
