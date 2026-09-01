import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/jobs/page-header";
import { ContactForm } from "@/components/jobs/contact-form";
import { createContact } from "@/lib/actions/jobs-contacts";
import { companyOptions } from "@/lib/jobs/queries";

export const dynamic = "force-dynamic";

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
    const user = await requireUser();
    const { companyId } = await searchParams;
    const companies = await companyOptions(user.id);
    return (
        <div className="w-full">
            <PageHeader title="Add contact" />
            <ContactForm
                action={createContact}
                companies={companies.map((c) => ({ id: c.id, name: c.name }))}
                defaults={{ companyId }}
                submitLabel="Create contact"
                cancelHref="/career/contacts"
            />
        </div>
    );
}
