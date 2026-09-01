import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Clock, Edit01, LinkExternal01, MarkerPin01, Trash01, Users01 } from "@untitledui/icons";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { fmtDate, fmtDateTime, fmtSalary, toDateTimeInput } from "@/lib/jobs/format";
import { WORK_TYPE_LABELS, HEARD_FROM_SOURCES } from "@/lib/jobs/enums";
import { pickerDocs } from "@/lib/jobs/queries";
import { PageHeader } from "@/components/jobs/page-header";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { CompanyLogo } from "@/components/jobs/company-logo";
import { Markdown } from "@/components/jobs/markdown";
import { StatusSelect } from "@/components/jobs/status-select";
import { MeetingDialog } from "@/components/jobs/meeting-dialog";
import { AttachmentList, AttachmentUploader } from "@/components/jobs/attachments";
import { NotesEditor } from "@/components/jobs/notes-editor";
import { DeleteButton } from "@/components/jobs/delete-button";
import { PriorityStars } from "@/components/career/application-extras";
import { ApplicationPowerSection } from "@/components/career/application-power-section";
import { OffersSection } from "@/components/career/offers-section";
import { ApplicationAiTools } from "@/components/career/application-ai-tools";
import { InlineDocsPicker } from "@/components/jobs/inline-docs-picker";
import { cx } from "@/utils/cx";
import {
    deleteApplication,
    uploadApplicationAttachments,
    updateApplicationNotes,
    deleteAttachment,
    createMeeting,
    updateMeeting,
    deleteMeeting,
} from "@/lib/actions/jobs";

export const dynamic = "force-dynamic";

function Detail({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="flex items-center gap-1.5 text-xs text-tertiary">
                {icon}
                {label}
            </div>
            <div className="mt-0.5 text-sm text-secondary">{children}</div>
        </div>
    );
}

function SourceDisplay({ value }: { value: string }) {
    const source = HEARD_FROM_SOURCES.find((s) => s.id === value || s.label === value);
    const label = source?.label ?? value;
    const domain = source?.domain as string | null | undefined;
    return (
        <span className="inline-flex items-center gap-1.5">
            {domain && (
                <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white ring-1 ring-secondary ring-inset">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`https://img.logokit.com/${domain}`} alt="" className="size-full object-contain" />
                </span>
            )}
            {label}
        </span>
    );
}

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser();
    const { id } = await params;

    const [application, contacts, resumeDocs, coverLetterDocs] = await Promise.all([
        db.jobApplication.findFirst({
            where: { id, userId: user.id },
            include: {
                company: true,
                resumeVersion: { include: { document: true } },
                coverLetterVersion: { include: { document: true } },
                attachments: { orderBy: { createdAt: "desc" } },
                meetings: {
                    orderBy: { dateTime: "desc" },
                    include: { participants: true, attachments: { orderBy: { createdAt: "desc" } } },
                },
                events: { orderBy: { createdAt: "desc" } },
                interviewRounds: { orderBy: { roundNumber: "asc" } },
                prepItems: { orderBy: { sortOrder: "asc" } },
                questions: { orderBy: { createdAt: "desc" } },
                offers: { orderBy: { createdAt: "desc" }, include: { negotiationSteps: { orderBy: { date: "asc" } } } },
                referredBy: { select: { id: true, name: true } },
            },
        }),
        db.jobContact.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, include: { company: { select: { name: true } } } }),
        pickerDocs(user.id, "RESUME"),
        pickerDocs(user.id, "COVER_LETTER"),
    ]);
    if (!application) notFound();

    const contactOptions = contacts.map((c) => ({ id: c.id, name: c.name, companyName: c.company?.name ?? null }));
    const path = `/career/applications/${id}`;

    return (
        <div className="w-full">
            <PageHeader title={application.role}>
                <PriorityStars id={id} value={application.priority} />
                <Button href={`${path}/edit`} color="secondary" iconLeading={<Edit01 data-icon className="size-4" />}>
                    Edit
                </Button>
                <DeleteButton action={deleteApplication} id={id} title="Delete application?" description="This permanently removes the application, its meetings and attachments." />
            </PageHeader>

            <div className="grid gap-6 md:grid-cols-3">
                <div className="flex flex-col gap-6 md:col-span-2">
                    <Card>
                        <CardBody className="grid gap-4 sm:grid-cols-2">
                            <div className="flex items-center justify-between gap-3 sm:col-span-2">
                                <Link href={`/career/companies/${application.companyId}`} className="inline-flex items-center gap-2 font-medium text-primary hover:underline">
                                    <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded bg-primary ring-1 ring-secondary">
                                        <CompanyLogo src={companyLogoSrc(application.company)} alt={application.company.name} name={application.company.name} className="size-full object-contain" iconClassName="text-[0.6rem]" />
                                    </span>
                                    {application.company.name}
                                </Link>
                                <StatusSelect id={id} status={application.status} />
                            </div>

                            <Detail icon={<MarkerPin01 className="size-4" />} label="Location">
                                {application.location ?? "—"}
                            </Detail>
                            <Detail label="Work type">{WORK_TYPE_LABELS[application.workType]}</Detail>
                            <Detail icon={<Calendar className="size-4" />} label="Date applied">
                                {fmtDate(application.dateApplied)}
                            </Detail>
                            <Detail icon={<Clock className="size-4" />} label="Deadline">
                                {fmtDate(application.deadline)}
                            </Detail>
                            <Detail label="Expected salary">{fmtSalary(application.salaryMin, application.salaryMax, application.salaryCurrency)}</Detail>
                            <Detail label="Heard via">
                                {application.heardFrom ? <SourceDisplay value={application.heardFrom} /> : "—"}
                            </Detail>
                            <Detail label="Referred by">
                                {application.referredBy ? (
                                    <Link href={`/career/contacts/${application.referredBy.id}`} className="text-brand-secondary hover:underline">
                                        {application.referredBy.name}
                                    </Link>
                                ) : application.referredByName ? (
                                    `${application.referredByName}${application.referredByRelationship ? ` (${application.referredByRelationship})` : ""}`
                                ) : (
                                    "—"
                                )}
                            </Detail>
                            {application.applicationUrl && (
                                <div className="sm:col-span-2">
                                    <a
                                        href={application.applicationUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 text-sm text-brand-secondary hover:underline"
                                    >
                                        <LinkExternal01 className="size-4" />
                                        View job posting
                                    </a>
                                </div>
                            )}
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader title="Notes" />
                        <CardBody>
                            <NotesEditor action={updateApplicationNotes.bind(null, id)} defaultValue={application.notesMarkdown ?? ""} />
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader
                            title={`Meetings (${application.meetings.length})`}
                            action={<MeetingDialog action={createMeeting.bind(null, id)} contacts={contactOptions} />}
                        />
                        <CardBody className="flex flex-col gap-4">
                            {application.meetings.length === 0 ? (
                                <p className="text-sm text-tertiary">No meetings logged.</p>
                            ) : (
                                application.meetings.map((m) => (
                                    <div key={m.id} className="rounded-lg ring-1 ring-secondary ring-inset">
                                        <div className="flex items-start justify-between gap-2 p-3">
                                            <div>
                                                <div className="font-medium text-primary">
                                                    {m.type ?? "Meeting"}
                                                    {m.durationMinutes ? <span className="ml-2 text-xs font-normal text-tertiary">{m.durationMinutes} min</span> : null}
                                                </div>
                                                <div className="text-xs text-tertiary">
                                                    {fmtDateTime(m.dateTime)}
                                                    {m.location ? ` · ${m.location}` : ""}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <MeetingDialog
                                                    mode="edit"
                                                    action={updateMeeting.bind(null, m.id)}
                                                    contacts={contactOptions}
                                                    defaults={{
                                                        type: m.type,
                                                        durationMinutes: m.durationMinutes,
                                                        dateTime: toDateTimeInput(m.dateTime),
                                                        location: m.location,
                                                        notesMarkdown: m.notesMarkdown,
                                                        participantIds: m.participants.map((p) => p.id),
                                                        participantNames: m.participantNames,
                                                    }}
                                                />
                                                <form action={deleteMeeting}>
                                                    <input type="hidden" name="id" value={m.id} />
                                                    <Button type="submit" color="tertiary-destructive" size="sm" iconLeading={<Trash01 data-icon className="size-4" />} aria-label="Delete meeting" />
                                                </form>
                                            </div>
                                        </div>

                                        {(m.participants.length > 0 || m.participantNames.length > 0) && (
                                            <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
                                                <Users01 className="size-3.5 text-fg-quaternary" />
                                                {m.participants.map((p) => (
                                                    <Link key={p.id} href={`/career/contacts/${p.id}`}>
                                                        <Badge color="brand" size="sm">
                                                            {p.name}
                                                        </Badge>
                                                    </Link>
                                                ))}
                                                {m.participantNames.map((n) => (
                                                    <Badge key={n} color="gray" size="sm">
                                                        {n}
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}

                                        {m.notesMarkdown?.trim() && (
                                            <div className="border-t border-secondary px-3 py-2">
                                                <Markdown>{m.notesMarkdown}</Markdown>
                                            </div>
                                        )}

                                        {m.attachments.length > 0 && (
                                            <div className="border-t border-secondary p-3">
                                                <AttachmentList attachments={m.attachments} onDelete={deleteAttachment} revalidate={path} />
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </CardBody>
                    </Card>

                    <ApplicationPowerSection
                        id={id}
                        companyId={application.companyId}
                        jdText={application.jdText}
                        rounds={application.interviewRounds}
                        prepItems={application.prepItems}
                        questions={application.questions}
                    />

                    <OffersSection applicationId={id} offers={application.offers} defaultCurrency={application.salaryCurrency ?? "USD"} />
                </div>

                <div className="flex flex-col gap-6">
                    <ApplicationAiTools applicationId={id} />

                    <Card>
                        <CardHeader title="Documents used" />
                        <CardBody>
                            <InlineDocsPicker
                                applicationId={id}
                                resumeDocs={resumeDocs}
                                coverLetterDocs={coverLetterDocs}
                                defaultResumeVersionId={application.resumeVersionId}
                                defaultCoverLetterVersionId={application.coverLetterVersionId}
                            />
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader title="Attachments" />
                        <CardBody className="flex flex-col gap-3">
                            <AttachmentList attachments={application.attachments} onDelete={deleteAttachment} revalidate={path} />
                            <AttachmentUploader action={uploadApplicationAttachments.bind(null, id)} />
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader title="Activity" />
                        <CardBody>
                            {application.events.length === 0 ? (
                                <p className="text-sm text-tertiary">No activity logged yet.</p>
                            ) : (
                                <ol className="relative flex flex-col gap-3 border-l border-secondary pl-4">
                                    {application.events.map((e) => (
                                        <li key={e.id} className="relative">
                                            <span
                                                className={cx(
                                                    "absolute -left-[1.32rem] top-1 size-2 rounded-full ring-2 ring-bg-primary",
                                                    e.type === "created"
                                                        ? "bg-success-solid"
                                                        : e.type === "status"
                                                          ? "bg-warning-solid"
                                                          : e.type === "meeting"
                                                            ? "bg-brand-solid"
                                                            : e.type === "attachment"
                                                              ? "bg-quaternary"
                                                              : "bg-brand-solid",
                                                )}
                                            />
                                            <div className="text-sm text-secondary">{e.message}</div>
                                            <div className="text-xs text-tertiary">{fmtDateTime(e.createdAt)}</div>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </CardBody>
                    </Card>
                </div>
            </div>
        </div>
    );
}
