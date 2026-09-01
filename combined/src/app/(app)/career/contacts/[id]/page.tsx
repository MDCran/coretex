import Link from "next/link";
import { notFound } from "next/navigation";
import { Edit01, Hash02, LinkExternal01, Mail01, MarkerPin01, Phone, Star01, Trash01 } from "@untitledui/icons";
import type { ContactMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { CompanyLogo } from "@/components/jobs/company-logo";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/jobs/format";
import { CONTACT_METHOD_LABELS } from "@/lib/jobs/enums";
import { PageHeader } from "@/components/jobs/page-header";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { Avatar } from "@/components/base/avatar/avatar";
import { LiveClock } from "@/components/jobs/live-clock";
import { InteractionDialog } from "@/components/jobs/interaction-dialog";
import { NotesEditor } from "@/components/jobs/notes-editor";
import { DeleteButton } from "@/components/jobs/delete-button";
import { deleteContact, addInteraction, deleteInteraction, updateContactNotes } from "@/lib/actions/jobs-contacts";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser();
    const { id } = await params;
    const contact = await db.jobContact.findFirst({
        where: { id, userId: user.id },
        include: {
            company: true,
            interactions: { orderBy: { date: "desc" } },
            meetings: { orderBy: { dateTime: "desc" }, include: { application: { include: { company: true } } } },
        },
    });
    if (!contact) notFound();

    const channels: { method: ContactMethod; icon: React.ReactNode; value: string | null; href?: string }[] = [
        { method: "EMAIL", icon: <Mail01 className="size-4" />, value: contact.email, href: contact.email ? `mailto:${contact.email}` : undefined },
        { method: "PHONE", icon: <Phone className="size-4" />, value: contact.phone, href: contact.phone ? `tel:${contact.phone}` : undefined },
        { method: "LINKEDIN", icon: <LinkExternal01 className="size-4" />, value: contact.linkedinUrl ? "LinkedIn profile" : null, href: contact.linkedinUrl ?? undefined },
        { method: "DISCORD", icon: <Hash02 className="size-4" />, value: contact.discord },
    ];

    return (
        <div className="w-full">
            <PageHeader title={contact.name}>
                <Button href={`/career/contacts/${id}/edit`} color="secondary" iconLeading={<Edit01 data-icon className="size-4" />}>
                    Edit
                </Button>
                <DeleteButton action={deleteContact} id={id} title="Delete contact?" />
            </PageHeader>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="md:col-span-1">
                    <CardBody className="flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                            <Avatar size="lg" initials={contact.name.slice(0, 2).toUpperCase()} alt={contact.name} />
                            <div>
                                <div className="font-medium text-primary">{contact.name}</div>
                                {contact.pronouns && <div className="text-xs text-tertiary">{contact.pronouns}</div>}
                            </div>
                        </div>

                        {(contact.role || contact.company) && (
                            <div className="text-sm text-secondary">
                                {contact.role}
                                {contact.role && contact.company ? " · " : ""}
                                {contact.company && (
                                    <Link href={`/career/companies/${contact.company.id}`} className="inline-flex items-center gap-1.5 text-brand-secondary hover:underline">
                                        <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-primary ring-1 ring-secondary">
                                            <CompanyLogo src={companyLogoSrc(contact.company)} alt={contact.company.name} name={contact.company.name} className="size-full object-contain" iconClassName="text-[0.5rem]" />
                                        </span>
                                        {contact.company.name}
                                    </Link>
                                )}
                            </div>
                        )}

                        {contact.location && (
                            <div className="flex items-center gap-1.5 text-sm text-tertiary">
                                <MarkerPin01 className="size-4" />
                                {contact.location}
                            </div>
                        )}
                        {contact.timezone && <LiveClock timezone={contact.timezone} />}

                        <div className="flex flex-col gap-1.5 border-t border-secondary pt-3">
                            {channels
                                .filter((c) => c.value)
                                .map((c) => {
                                    const preferred = contact.preferredContactMethod === c.method;
                                    const inner = (
                                        <span className="inline-flex items-center gap-1.5">
                                            {c.icon}
                                            {c.value}
                                            {preferred && <Star01 className="size-3 text-warning-primary" />}
                                        </span>
                                    );
                                    return (
                                        <div key={c.method} className="text-sm text-secondary">
                                            {c.href ? (
                                                <a href={c.href} target="_blank" rel="noreferrer" className="text-brand-secondary hover:underline">
                                                    {inner}
                                                </a>
                                            ) : (
                                                inner
                                            )}
                                        </div>
                                    );
                                })}
                            {contact.preferredContactMethod && (
                                <div className="pt-1">
                                    <Badge color="gray" size="sm">
                                        Prefers {CONTACT_METHOD_LABELS[contact.preferredContactMethod]}
                                    </Badge>
                                </div>
                            )}
                        </div>

                        <div className="border-t border-secondary pt-3 text-xs text-tertiary">Last contacted {fmtRelative(contact.lastContactedAt)}</div>
                    </CardBody>
                </Card>

                <div className="flex flex-col gap-6 md:col-span-2">
                    <Card>
                        <CardHeader title="Notes" />
                        <CardBody>
                            <NotesEditor action={updateContactNotes.bind(null, id)} defaultValue={contact.notesMarkdown ?? ""} />
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader title={`Contact history (${contact.interactions.length})`} action={<InteractionDialog action={addInteraction.bind(null, id)} />} />
                        <CardBody>
                            {contact.interactions.length === 0 ? (
                                <p className="text-sm text-tertiary">No interactions logged.</p>
                            ) : (
                                <ul className="flex flex-col gap-2">
                                    {contact.interactions.map((i) => (
                                        <li key={i.id} className="flex items-start justify-between gap-3 rounded-lg p-2.5 ring-1 ring-secondary ring-inset">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-primary">{fmtDate(i.date)}</span>
                                                    {i.channel && (
                                                        <Badge color="gray" size="sm">
                                                            {CONTACT_METHOD_LABELS[i.channel]}
                                                        </Badge>
                                                    )}
                                                </div>
                                                {i.note && <p className="mt-0.5 text-sm text-tertiary">{i.note}</p>}
                                            </div>
                                            <form action={deleteInteraction}>
                                                <input type="hidden" name="id" value={i.id} />
                                                <Button type="submit" color="tertiary-destructive" size="sm" iconLeading={<Trash01 data-icon className="size-4" />} aria-label="Delete interaction" />
                                            </form>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardBody>
                    </Card>

                    {contact.meetings.length > 0 && (
                        <Card>
                            <CardHeader title={`Meetings attended (${contact.meetings.length})`} />
                            <CardBody>
                                <ul className="flex flex-col divide-y divide-secondary">
                                    {contact.meetings.map((m) => (
                                        <li key={m.id}>
                                            <Link href={`/career/applications/${m.applicationId}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                                                <div>
                                                    <div className="text-sm font-medium text-primary">{m.type ?? "Meeting"}</div>
                                                    <div className="text-xs text-tertiary">
                                                        {m.application.company.name} · {m.application.role}
                                                    </div>
                                                </div>
                                                <span className="text-xs text-tertiary">{fmtDateTime(m.dateTime)}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </CardBody>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
