"use client";

import { Button } from "@/components/base/buttons/button";
import { Card, CardBody } from "@/components/jobs/card";
import { TextInput, SelectInput, TextareaInput, DateInput } from "@/components/jobs/fields";
import { CompanyCombobox } from "@/components/jobs/company-combobox";
import { LocationCombobox, type SavedLocation } from "@/components/jobs/location-combobox";
import { SourcePicker } from "@/components/jobs/source-picker";
import { VersionPicker, type PickerDoc } from "@/components/jobs/version-picker";
import { SubmitButton } from "@/components/jobs/submit-button";
import { STATUS_LABELS, STATUS_ORDER, WORK_TYPE_LABELS, PRIORITY_LABELS, toOptions } from "@/lib/jobs/enums";
import type { CompanyLogoSources } from "@/lib/jobs/logos";

type CompanyOption = { id: string; name: string; logo?: CompanyLogoSources };
type PhaseOption = { id: string; name: string; archived: boolean };
type TargetOption = { id: string; title: string };

export type ApplicationDefaults = Partial<{
    companyId: string | null;
    role: string | null;
    applicationUrl: string | null;
    status: string;
    workType: string;
    heardFrom: string | null;
    location: string | null;
    dateApplied: string;
    deadline: string;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    resumeVersionId: string | null;
    coverLetterVersionId: string | null;
    phaseId: string | null;
    targetId: string | null;
    notesMarkdown: string | null;
    priority: number | null;
    referredByName: string | null;
    referredByRelationship: string | null;
}>;

export function ApplicationForm({
    action,
    companies,
    savedLocations,
    resumeDocs,
    coverLetterDocs,
    phases,
    targets,
    defaults = {},
    submitLabel,
    cancelHref,
}: {
    action: (formData: FormData) => void | Promise<void>;
    companies: CompanyOption[];
    savedLocations: SavedLocation[];
    resumeDocs: PickerDoc[];
    coverLetterDocs: PickerDoc[];
    phases: PhaseOption[];
    targets: TargetOption[];
    defaults?: ApplicationDefaults;
    submitLabel: string;
    cancelHref?: string;
}) {
    return (
        <form action={action} className="flex flex-col gap-6">
            <Card>
                <CardBody className="grid gap-5 sm:grid-cols-2">
                    <CompanyCombobox name="companyId" label="Company" companies={companies} defaultValue={defaults.companyId} isRequired />
                    <TextInput name="role" label="Role" isRequired defaultValue={defaults.role ?? ""} placeholder="Software Engineer" />

                    <TextInput
                        name="applicationUrl"
                        label="Job posting URL"
                        type="url"
                        defaultValue={defaults.applicationUrl ?? ""}
                        placeholder="https://…"
                        fieldClassName="sm:col-span-2"
                    />

                    <SelectInput name="status" label="Status" defaultValue={defaults.status ?? "NOT_STARTED"} options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
                    <SelectInput name="workType" label="Work type" defaultValue={defaults.workType ?? "NA"} options={toOptions(WORK_TYPE_LABELS)} />

                    <DateInput name="dateApplied" label="Date applied" defaultValue={defaults.dateApplied ?? ""} />
                    <DateInput name="deadline" label="Deadline" defaultValue={defaults.deadline ?? ""} />

                    <TextInput name="salaryMin" label="Salary min" type="number" inputMode="numeric" defaultValue={defaults.salaryMin ?? ""} placeholder="120000" />
                    <TextInput name="salaryMax" label="Salary max" type="number" inputMode="numeric" defaultValue={defaults.salaryMax ?? ""} placeholder="150000" />

                    <TextInput name="salaryCurrency" label="Currency" defaultValue={defaults.salaryCurrency ?? "USD"} placeholder="USD" />
                    <LocationCombobox name="location" label="Location" defaultValue={defaults.location} savedLocations={savedLocations} />

                    <SourcePicker name="heardFrom" label="Source" defaultValue={defaults.heardFrom} />
                    <SelectInput
                        name="phaseId"
                        label="Phase"
                        placeholder="No phase"
                        defaultValue={defaults.phaseId ?? ""}
                        options={phases.map((p) => ({ value: p.id, label: p.archived ? `${p.name} (archived)` : p.name }))}
                    />

                    <SelectInput
                        name="targetId"
                        label="Career goal"
                        placeholder="No linked goal"
                        defaultValue={defaults.targetId ?? ""}
                        options={targets.map((target) => ({ value: target.id, label: target.title }))}
                    />

                    <SelectInput
                        name="priority"
                        label="Priority"
                        defaultValue={String(defaults.priority ?? 0)}
                        options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: PRIORITY_LABELS[n] }))}
                    />

                    <TextInput name="referredByName" label="Referred by" defaultValue={defaults.referredByName ?? ""} placeholder="Who referred you in" />
                    <TextInput name="referredByRelationship" label="Referrer relationship" defaultValue={defaults.referredByRelationship ?? ""} placeholder="Former coworker, friend…" />
                </CardBody>
            </Card>

            <Card>
                <CardBody className="flex flex-col gap-5">
                    <VersionPicker name="resumeVersionId" label="Resume version" documents={resumeDocs} defaultVersionId={defaults.resumeVersionId} />
                    <VersionPicker name="coverLetterVersionId" label="Cover letter version" documents={coverLetterDocs} defaultVersionId={defaults.coverLetterVersionId} />
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <TextareaInput name="notesMarkdown" label="Notes (Markdown)" rows={5} defaultValue={defaults.notesMarkdown ?? ""} placeholder="Anything to remember…" />
                </CardBody>
            </Card>

            <div className="flex justify-end gap-3 pb-20">
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
