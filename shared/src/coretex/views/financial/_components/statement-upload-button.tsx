// @ts-nocheck

import { Field, NativeInput } from "./financial-ui";
import { FormModal } from "./form-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";
import { UploadCloud02 } from "@untitledui/icons";
import { useState } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";

interface Props {
    /** Pre-links the uploaded statement to this account. */
    finAccountId?: string;
    /** Pre-links the uploaded statement to this card. */
    creditCardId?: string;
    /** Pre-links the uploaded statement to this brokerage account. */
    brokerageAccountId?: string;
    /** Friendly name of the target, shown in the modal subtitle. */
    targetLabel: string;
    /** Whether AI extraction is configured (controls the hint text). */
    aiConfigured?: boolean;
    size?: "sm" | "md";
    color?: "primary" | "secondary";
}

/** Upload-statement button that pre-links the new statement to a specific account/card/brokerage. */
export function StatementUploadButton({ finAccountId, creditCardId, brokerageAccountId, targetLabel, aiConfigured = false, size = "sm", color = "secondary" }: Props) {
    const [open, setOpen] = useState(false);
    const [uploading, setUploading] = useState(false);

    async function onUpload(fd: FormData) {
        if (finAccountId) fd.set("finAccountId", finAccountId);
        if (creditCardId) fd.set("creditCardId", creditCardId);
        if (brokerageAccountId) fd.set("brokerageAccountId", brokerageAccountId);
        setUploading(true);
        try {
            await uploadStatement(fd);
            toast.success(aiConfigured ? "Statement uploaded — extracting with AI…" : "Statement uploaded and linked");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Upload failed");
        } finally {
            setUploading(false);
        }
    }

    return (
        <>
            <Button size={size} color={color} iconLeading={UploadCloud02} onClick={() => setOpen(true)}>
                Upload statement
            </Button>
            <FormModal isOpen={open} onOpenChange={setOpen} title="Upload statement" description={`Linked to ${targetLabel}`}>
                <form action={onUpload} className="flex flex-col gap-4">
                    <Field label="File" htmlFor="file">
                        <FormFileUpload name="file" hint="PDF, image or any document up to 25 MB." />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <FormDateInput name="periodStart" label="Period start" />
                        <FormDateInput name="periodEnd" label="Period end" />
                    </div>
                    <Field label="Ending balance" htmlFor="endingBalanceU">
                        <NativeInput id="endingBalanceU" name="endingBalance" type="number" step="0.01" />
                    </Field>
                    <p className="text-xs text-tertiary">
                        {aiConfigured
                            ? "PDFs are parsed automatically with AI to extract the period, balance and transactions."
                            : "Add ANTHROPIC_API_KEY to enable AI extraction. Until then, set the period and ending balance manually."}
                    </p>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" isLoading={uploading}>
                            Upload
                        </Button>
                    </div>
                </form>
            </FormModal>
        </>
    );
}
