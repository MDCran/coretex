import Link from "next/link";
import { HelpCircle, Lightbulb02 } from "@untitledui/icons";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/jobs/page-header";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { DeleteButton } from "@/components/jobs/delete-button";
import { StarDialog } from "@/components/career/star-dialog";
import { QuestionDialog } from "@/components/career/question-dialog";
import { createQuestion, createStarStory, deleteQuestion, deleteStarStory, updateQuestion, updateStarStory } from "@/lib/actions/career-advanced";

export const dynamic = "force-dynamic";

function StarPart({ label, text }: { label: string; text: string | null }) {
    if (!text?.trim()) return null;
    return (
        <div>
            <span className="text-xs font-semibold text-quaternary uppercase">{label}</span>
            <p className="text-sm text-secondary">{text}</p>
        </div>
    );
}

export default async function PrepPage() {
    const user = await requireUser();
    const [stories, questions] = await Promise.all([
        db.starStory.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
        db.interviewQuestion.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            include: { company: { select: { name: true } }, application: { select: { id: true, role: true } } },
        }),
    ]);

    return (
        <div className="flex w-full flex-col gap-6">
            <PageHeader title="Interview prep" description="Your reusable STAR stories and the question bank from every interview." />

            <Card>
                <CardHeader title={`STAR story library (${stories.length})`} action={<StarDialog action={createStarStory} />} />
                <CardBody className="flex flex-col gap-4">
                    {stories.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <FeaturedIcon icon={Lightbulb02} color="brand" theme="light" size="lg" />
                            <p className="text-sm font-semibold text-primary">Build your STAR story bank</p>
                            <p className="max-w-sm text-sm text-tertiary">
                                Capture your strongest behavioral stories once, tag them, and reuse them to answer "tell me about a time…" with confidence.
                            </p>
                            <div className="mt-1">
                                <StarDialog action={createStarStory} />
                            </div>
                        </div>
                    ) : (
                        stories.map((s) => (
                            <div key={s.id} className="rounded-lg ring-1 ring-secondary ring-inset">
                                <div className="flex items-start justify-between gap-2 border-b border-secondary p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-primary">{s.title}</span>
                                        {s.tags.map((t) => (
                                            <Badge key={t} color="gray" size="sm" type="modern">
                                                {t}
                                            </Badge>
                                        ))}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <StarDialog
                                            mode="edit"
                                            action={updateStarStory.bind(null, s.id)}
                                            defaults={{ title: s.title, situation: s.situation, task: s.task, action: s.action, result: s.result, tags: s.tags }}
                                        />
                                        <DeleteButton action={deleteStarStory} id={s.id} iconOnly title="Delete story?" description="This removes the STAR story." />
                                    </div>
                                </div>
                                <div className="grid gap-3 p-3 sm:grid-cols-2">
                                    <StarPart label="Situation" text={s.situation} />
                                    <StarPart label="Task" text={s.task} />
                                    <StarPart label="Action" text={s.action} />
                                    <StarPart label="Result" text={s.result} />
                                </div>
                            </div>
                        ))
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardHeader title={`Question bank (${questions.length})`} action={<QuestionDialog action={createQuestion} triggerLabel="Add question" />} />
                <CardBody className="flex flex-col gap-3">
                    {questions.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <FeaturedIcon icon={HelpCircle} color="brand" theme="light" size="lg" />
                            <p className="text-sm font-semibold text-primary">Start your question bank</p>
                            <p className="max-w-sm text-sm text-tertiary">
                                Save every question you're asked in an interview, draft your best answer, and walk into the next round already prepared.
                            </p>
                            <div className="mt-1">
                                <QuestionDialog action={createQuestion} triggerLabel="Add your first question" />
                            </div>
                        </div>
                    ) : (
                        questions.map((q) => (
                            <div key={q.id} className="rounded-lg ring-1 ring-secondary ring-inset">
                                <div className="flex items-start justify-between gap-2 p-3">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-primary">{q.question}</div>
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-tertiary">
                                            {q.category && (
                                                <Badge color="gray" size="sm" type="modern">
                                                    {q.category}
                                                </Badge>
                                            )}
                                            {q.company?.name && <span>{q.company.name}</span>}
                                            {q.application && (
                                                <Link href={`/career/applications/${q.application.id}`} className="text-brand-secondary hover:underline">
                                                    {q.application.role}
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <QuestionDialog mode="edit" action={updateQuestion.bind(null, q.id)} defaults={{ question: q.question, answer: q.answer, category: q.category }} />
                                        <DeleteButton action={deleteQuestion} id={q.id} iconOnly title="Delete question?" description="This removes the stored question and answer." />
                                    </div>
                                </div>
                                {q.answer?.trim() && <div className="border-t border-secondary px-3 py-2 text-sm text-secondary whitespace-pre-wrap">{q.answer}</div>}
                            </div>
                        ))
                    )}
                </CardBody>
            </Card>
        </div>
    );
}
