"use client";

import { Button } from "@/components/base/buttons/button";
import { Card, CardBody } from "@/components/jobs/card";
import { TextInput, SelectInput, TextareaInput } from "@/components/jobs/fields";
import { TimezoneSelect } from "@/components/jobs/timezone-select";
import { SubmitButton } from "@/components/jobs/submit-button";
import { CONTACT_METHOD_LABELS, JOB_CONTACT_KIND_LABELS, toOptions } from "@/lib/jobs/enums";

type CompanyOption = { id: string; name: string };

export type ContactDefaults = Partial<{
    name: string | null;
    companyId: string | null;
    role: string | null;
    kind: string | null;
    preferredContactMethod: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    discord: string | null;
    pronouns: string | null;
    location: string | null;
    timezone: string | null;
    notesMarkdown: string | null;
}>;

export function ContactForm({
    action,
    companies,
    defaults = {},
    submitLabel,
    cancelHref,
}: {
    action: (formData: FormData) => void | Promise<void>;
    companies: CompanyOption[];
    defaults?: ContactDefaults;
    submitLabel: string;
    cancelHref?: string;
}) {
    return (
        <form action={action} className="flex flex-col gap-6">
            <Card>
                <CardBody className="grid gap-5 sm:grid-cols-2">
                    <TextInput name="name" label="Name" isRequired defaultValue={defaults.name ?? ""} />
                    <TextInput name="role" label="Role / title" defaultValue={defaults.role ?? ""} placeholder="Recruiter" />
                    <SelectInput name="kind" label="Type" placeholder="—" defaultValue={defaults.kind ?? ""} options={toOptions(JOB_CONTACT_KIND_LABELS)} />
                    <SelectInput name="companyId" label="Company" placeholder="—" defaultValue={defaults.companyId ?? ""} options={companies.map((c) => ({ value: c.id, label: c.name }))} />
                    <SelectInput
                        name="preferredContactMethod"
                        label="Preferred contact method"
                        placeholder="—"
                        defaultValue={defaults.preferredContactMethod ?? ""}
                        options={toOptions(CONTACT_METHOD_LABELS)}
                    />
                    <TextInput name="email" label="Email" type="email" defaultValue={defaults.email ?? ""} />
                    <TextInput name="phone" label="Phone" defaultValue={defaults.phone ?? ""} />
                    <TextInput name="linkedinUrl" label="LinkedIn URL" type="url" defaultValue={defaults.linkedinUrl ?? ""} />
                    <TextInput name="discord" label="Discord" defaultValue={defaults.discord ?? ""} />
                    <TextInput name="pronouns" label="Pronouns" defaultValue={defaults.pronouns ?? ""} placeholder="she/her" />
                    <TextInput name="location" label="Location" defaultValue={defaults.location ?? ""} />
                    <TimezoneSelect name="timezone" label="Timezone" defaultValue={defaults.timezone} />
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <TextareaInput name="notesMarkdown" label="Notes (Markdown)" rows={4} defaultValue={defaults.notesMarkdown ?? ""} />
                </CardBody>
            </Card>

            <div className="flex justify-end gap-3">
                {cancelHref && (
                    <Button href={cancelHref} color="secondary">
                        Cancel
                    </Button>
                )}
                <SubmitButton color="primary">{submitLabel}</SubmitButton>
            </div>
        </form>
    );
}
