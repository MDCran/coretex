import { CalendarCheck01, CheckCircle, HelpCircle, Mail01, Star01 } from "@untitledui/icons";
import type { InterviewFormat, RoundOutcome } from "@prisma/client";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { EmptyState } from "@/components/career/career-ui";
import { Markdown } from "@/components/jobs/markdown";
import { NotesEditor } from "@/components/jobs/notes-editor";
import { DeleteButton } from "@/components/jobs/delete-button";
import { fmtDateTime, toDateTimeInput } from "@/lib/jobs/format";
import { INTERVIEW_FORMAT_LABELS, ROUND_OUTCOME_BADGE_COLOR, ROUND_OUTCOME_LABELS } from "@/lib/jobs/enums";
import { InterviewRoundDialog } from "@/components/career/interview-round-dialog";
import { QuestionDialog } from "@/components/career/question-dialog";
import { PrepChecklist } from "@/components/career/application-extras";
import {
    createQuestion,
    createRound,
    deleteQuestion,
    deletePrepItem,
    deleteRound,
    toggleRoundThankYou,
    updateApplicationJd,
    updateQuestion,
    updateRound,
} from "@/lib/actions/career-advanced";

type RoundRow = {
    id: string;
    roundNumber: number;
    name: string | null;
    format: InterviewFormat;
    scheduledAt: Date | null;
    durationMinutes: number | null;
    outcome: RoundOutcome;
    selfRating: number | null;
    interviewerNames: string[];
    notesMarkdown: string | null;
    thankYouSent: boolean;
};

type PrepRow = { id: string; label: string; done: boolean };
type QuestionRow = { id: string; question: string; answer: string | null; category: string | null };

function Rating({ value }: { value: number }) {
    return (
        <span className="inline-flex items-center gap-0.5" aria-label={`Self rating ${value} of 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
                <Star01 key={n} className={n <= value ? "size-3.5 fill-current text-yellow-400" : "size-3.5 text-fg-quaternary"} />
            ))}
        </span>
    );
}

export function ApplicationPowerSection({
    id,
    companyId,
    jdText,
    rounds,
    prepItems,
    questions,
}: {
    id: string;
    companyId: string;
    jdText: string | null;
    rounds: RoundRow[];
    prepItems: PrepRow[];
    questions: QuestionRow[];
}) {
    const nextRoundNumber = (rounds.reduce((m, r) => Math.max(m, r.roundNumber), 0) || 0) + 1;

    return (
        <>
            {/* Interview rounds */}
            <Card>
                <CardHeader
                    title={`Interview rounds (${rounds.length})`}
                    action={<InterviewRoundDialog action={createRound.bind(null, id)} nextRoundNumber={nextRoundNumber} />}
                />
                <CardBody className="flex flex-col gap-3">
                    {rounds.length === 0 ? (
                        <EmptyState
                            icon={CalendarCheck01}
                            title="Track every interview round"
                            action={<InterviewRoundDialog action={createRound.bind(null, id)} nextRoundNumber={nextRoundNumber} triggerLabel="Log a round" />}
                        >
                            Log each conversation with format, interviewers, and a self-rating so you can spot what's working and prep sharper for the next one.
                        </EmptyState>
                    ) : (
                        rounds.map((r) => (
                            <div key={r.id} className="rounded-lg ring-1 ring-secondary ring-inset">
                                <div className="flex items-start justify-between gap-2 p-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium text-primary">{r.name ?? `Round ${r.roundNumber}`}</span>
                                            <Badge color="gray" size="sm" type="modern">
                                                {INTERVIEW_FORMAT_LABELS[r.format]}
                                            </Badge>
                                            <Badge color={ROUND_OUTCOME_BADGE_COLOR[r.outcome]} size="sm" type="pill-color">
                                                {ROUND_OUTCOME_LABELS[r.outcome]}
                                            </Badge>
                                            {r.selfRating != null && <Rating value={r.selfRating} />}
                                        </div>
                                        <div className="mt-0.5 text-xs text-tertiary">
                                            {fmtDateTime(r.scheduledAt)}
                                            {r.durationMinutes ? ` · ${r.durationMinutes} min` : ""}
                                            {r.interviewerNames.length ? ` · ${r.interviewerNames.join(", ")}` : ""}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <form action={toggleRoundThankYou}>
                                            <input type="hidden" name="id" value={r.id} />
                                            <Button
                                                type="submit"
                                                color={r.thankYouSent ? "primary" : "tertiary"}
                                                size="sm"
                                                iconLeading={r.thankYouSent ? CheckCircle : Mail01}
                                                aria-label={r.thankYouSent ? "Thank-you sent" : "Mark thank-you sent"}
                                            />
                                        </form>
                                        <InterviewRoundDialog
                                            mode="edit"
                                            action={updateRound.bind(null, r.id)}
                                            defaults={{
                                                roundNumber: r.roundNumber,
                                                name: r.name,
                                                format: r.format,
                                                scheduledAt: toDateTimeInput(r.scheduledAt),
                                                durationMinutes: r.durationMinutes,
                                                outcome: r.outcome,
                                                selfRating: r.selfRating,
                                                interviewerNames: r.interviewerNames,
                                                notesMarkdown: r.notesMarkdown,
                                                thankYouSent: r.thankYouSent,
                                            }}
                                        />
                                        <DeleteButton action={deleteRound} id={r.id} iconOnly title="Delete round?" description="This removes the interview round and its notes." />
                                    </div>
                                </div>
                                {r.notesMarkdown?.trim() && (
                                    <div className="border-t border-secondary px-3 py-2">
                                        <Markdown>{r.notesMarkdown}</Markdown>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </CardBody>
            </Card>

            {/* Interview prep checklist */}
            <Card>
                <CardHeader title="Interview prep" />
                <CardBody>
                    <PrepChecklist applicationId={id} items={prepItems} />
                </CardBody>
            </Card>

            {/* Question bank for this application */}
            <Card>
                <CardHeader
                    title={`Questions asked (${questions.length})`}
                    action={<QuestionDialog action={createQuestion} applicationId={id} companyId={companyId} />}
                />
                <CardBody className="flex flex-col gap-3">
                    {questions.length === 0 ? (
                        <EmptyState
                            icon={HelpCircle}
                            title="Build your answer bank"
                            action={<QuestionDialog action={createQuestion} applicationId={id} companyId={companyId} triggerLabel="Log a question" />}
                        >
                            Capture every question they ask and draft your best answer once — then walk into the next round already prepared.
                        </EmptyState>
                    ) : (
                        questions.map((q) => (
                            <div key={q.id} className="rounded-lg ring-1 ring-secondary ring-inset">
                                <div className="flex items-start justify-between gap-2 p-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                                            <HelpCircle className="size-4 shrink-0 text-fg-quaternary" />
                                            {q.question}
                                        </div>
                                        {q.category && (
                                            <Badge color="gray" size="sm" type="modern" className="mt-1">
                                                {q.category}
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <QuestionDialog
                                            mode="edit"
                                            action={updateQuestion.bind(null, q.id)}
                                            applicationId={id}
                                            companyId={companyId}
                                            defaults={{ question: q.question, answer: q.answer, category: q.category }}
                                        />
                                        <DeleteButton action={deleteQuestion} id={q.id} iconOnly title="Delete question?" description="This removes the stored question and answer." />
                                    </div>
                                </div>
                                {q.answer?.trim() && (
                                    <div className="border-t border-secondary px-3 py-2 text-sm text-secondary whitespace-pre-wrap">{q.answer}</div>
                                )}
                            </div>
                        ))
                    )}
                </CardBody>
            </Card>

            {/* Job description archive */}
            <Card>
                <CardHeader title="Job description (archived)" />
                <CardBody>
                    <NotesEditor action={updateApplicationJd.bind(null, id)} defaultValue={jdText ?? ""} name="jdText" />
                </CardBody>
            </Card>
        </>
    );
}
