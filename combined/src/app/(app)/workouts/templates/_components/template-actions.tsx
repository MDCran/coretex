"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Archive, Copy01, Trash01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { archiveTemplate, deleteTemplate, duplicateTemplate } from "@/lib/actions/workouts-templates";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";

export const TemplateActions = ({ templateId, archived }: { templateId: string; archived: boolean }) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const { confirm, dialog } = useConfirm();

    return (
        <div className="flex items-center gap-2">
            <Button
                size="md"
                color="secondary"
                iconLeading={Copy01}
                isLoading={pending}
                onClick={() =>
                    startTransition(async () => {
                        try {
                            const id = await duplicateTemplate(templateId);
                            toast.success("Template duplicated");
                            router.push(`/workouts/templates/${id}`);
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to duplicate");
                        }
                    })
                }
            >
                Duplicate
            </Button>
            <Button
                size="md"
                color="secondary"
                iconLeading={Archive}
                isLoading={pending}
                onClick={() =>
                    startTransition(async () => {
                        await archiveTemplate(templateId, !archived);
                        toast.success(archived ? "Template restored" : "Template archived");
                        router.push("/workouts/templates");
                    })
                }
            >
                {archived ? "Restore" : "Archive"}
            </Button>
            <ButtonUtility
                size="sm"
                color="tertiary"
                icon={Trash01}
                tooltip="Delete template"
                isDisabled={pending}
                onClick={() =>
                    confirm({
                        title: "Delete this template permanently?",
                        destructive: true,
                        confirmLabel: "Delete",
                        onConfirm: () =>
                            startTransition(async () => {
                                await deleteTemplate(templateId);
                                toast.success("Template deleted");
                                router.push("/workouts/templates");
                            }),
                    })
                }
            />
            {dialog}
        </div>
    );
};
