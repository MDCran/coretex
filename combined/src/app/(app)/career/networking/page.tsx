import { CheckCircle, MessageChatCircle, Send01 } from "@untitledui/icons";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/jobs/page-header";
import { Card, CardBody } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { DeleteButton } from "@/components/jobs/delete-button";
import { fmtDate, toDateInput } from "@/lib/jobs/format";
import { CONTACT_METHOD_LABELS } from "@/lib/jobs/enums";
import { OutreachDialog } from "@/components/career/outreach-dialog";
import { createOutreach, deleteOutreach, toggleOutreachResponded, updateOutreach } from "@/lib/actions/career-advanced";

export const dynamic = "force-dynamic";

export default async function NetworkingPage() {
    const user = await requireUser();
    const [outreach, contacts, companies] = await Promise.all([
        db.networkingOutreach.findMany({
            where: { userId: user.id },
            orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
            include: { company: { select: { name: true } }, contact: { select: { name: true } } },
        }),
        db.jobContact.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.company.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);

    const sent = outreach.length;
    const responded = outreach.filter((o) => o.responded).length;
    const converted = outreach.filter((o) => o.converted).length;
    const responseRate = sent ? Math.round((responded / sent) * 100) : 0;

    const stats = [
        { label: "Messages sent", value: sent, icon: Send01 },
        { label: "Responses", value: `${responded} · ${responseRate}%`, icon: MessageChatCircle },
        { label: "Conversations / referrals", value: converted, icon: CheckCircle },
    ];

    return (
        <div className="flex w-full flex-col gap-6">
            <PageHeader title="Networking outreach" description="Track cold messages, responses, and conversations you've started.">
                <OutreachDialog action={createOutreach} contacts={contacts} companies={companies} />
            </PageHeader>

            <div className="grid gap-5 sm:grid-cols-3">
                {stats.map((s) => (
                    <Card key={s.label}>
                        <CardBody className="flex items-center justify-between">
                            <div>
                                <div className="text-display-sm font-semibold text-primary">{s.value}</div>
                                <div className="text-sm text-tertiary">{s.label}</div>
                            </div>
                            <FeaturedIcon icon={s.icon} color="brand" theme="light" size="lg" />
                        </CardBody>
                    </Card>
                ))}
            </div>

            {outreach.length === 0 ? (
                <Card>
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                        <FeaturedIcon icon={Send01} color="brand" theme="light" size="lg" />
                        <p className="text-sm font-semibold text-primary">Turn cold outreach into warm intros</p>
                        <p className="max-w-sm text-sm text-tertiary">
                            Log every cold message and referral request, then watch your response and conversation rates climb as you refine your approach.
                        </p>
                        <div className="mt-1">
                            <OutreachDialog action={createOutreach} contacts={contacts} companies={companies} triggerLabel="Log your first outreach" />
                        </div>
                    </div>
                </Card>
            ) : (
                <Card>
                    <ul className="divide-y divide-secondary">
                        {outreach.map((o) => (
                            <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium text-primary">{o.personName}</span>
                                        {o.channel && (
                                            <Badge color="gray" size="sm" type="modern">
                                                {CONTACT_METHOD_LABELS[o.channel]}
                                            </Badge>
                                        )}
                                        {o.responded && (
                                            <Badge color="success" size="sm" type="pill-color">
                                                Responded
                                            </Badge>
                                        )}
                                        {o.converted && (
                                            <Badge color="brand" size="sm" type="pill-color">
                                                Conversation
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="mt-0.5 text-xs text-tertiary">
                                        Sent {fmtDate(o.sentAt)}
                                        {o.company?.name ? ` · ${o.company.name}` : ""}
                                        {o.contact?.name ? ` · ${o.contact.name}` : ""}
                                    </div>
                                    {o.notesMarkdown?.trim() && <p className="mt-1 max-w-2xl text-sm text-secondary">{o.notesMarkdown}</p>}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <form action={toggleOutreachResponded}>
                                        <input type="hidden" name="id" value={o.id} />
                                        <Button type="submit" color={o.responded ? "primary" : "secondary"} size="sm" iconLeading={<CheckCircle className="size-4" data-icon />} aria-label="Toggle responded" />
                                    </form>
                                    <OutreachDialog
                                        mode="edit"
                                        action={updateOutreach.bind(null, o.id)}
                                        contacts={contacts}
                                        companies={companies}
                                        defaults={{
                                            personName: o.personName,
                                            channel: o.channel,
                                            sentAt: toDateInput(o.sentAt),
                                            responded: o.responded,
                                            respondedAt: toDateInput(o.respondedAt),
                                            converted: o.converted,
                                            notesMarkdown: o.notesMarkdown,
                                            contactId: o.contactId,
                                            companyId: o.companyId,
                                        }}
                                    />
                                    <DeleteButton action={deleteOutreach} id={o.id} iconOnly title="Delete outreach?" description="Removes this outreach record." />
                                </div>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}
