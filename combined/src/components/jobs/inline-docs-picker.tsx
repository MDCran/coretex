"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { VersionPicker, type PickerDoc } from "@/components/jobs/version-picker";
import { updateApplicationDocuments } from "@/lib/actions/jobs";

export function InlineDocsPicker({
    applicationId,
    resumeDocs,
    coverLetterDocs,
    defaultResumeVersionId,
    defaultCoverLetterVersionId,
}: {
    applicationId: string;
    resumeDocs: PickerDoc[];
    coverLetterDocs: PickerDoc[];
    defaultResumeVersionId?: string | null;
    defaultCoverLetterVersionId?: string | null;
}) {
    const [pending, start] = useTransition();

    return (
        <form
            action={(fd) =>
                start(async () => {
                    try {
                        await updateApplicationDocuments(applicationId, fd);
                        toast.success("Documents updated");
                    } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed to update");
                    }
                })
            }
            className="flex flex-col gap-4"
        >
            <VersionPicker name="resumeVersionId" label="Resume" documents={resumeDocs} defaultVersionId={defaultResumeVersionId} />
            <VersionPicker name="coverLetterVersionId" label="Cover letter" documents={coverLetterDocs} defaultVersionId={defaultCoverLetterVersionId} />
            <div className="flex justify-end">
                <Button type="submit" color="primary" size="sm" isLoading={pending} showTextWhileLoading isDisabled={pending}>
                    Save
                </Button>
            </div>
        </form>
    );
}
