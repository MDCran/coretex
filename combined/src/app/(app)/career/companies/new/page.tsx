import { PageHeader } from "@/components/jobs/page-header";
import { CompanyForm } from "@/components/jobs/company-form";
import { createCompany } from "@/lib/actions/jobs-companies";

export default function NewCompanyPage() {
    return (
        <div className="w-full">
            <PageHeader title="Add company" />
            <CompanyForm action={createCompany} submitLabel="Create company" cancelHref="/career/companies" />
        </div>
    );
}
