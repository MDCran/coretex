"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy01, Stars02, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { generateCoverLetter } from "@/lib/actions/career-ai";

export function ApplicationAiTools({ applicationId }: { applicationId: string }) {
    const [pending, start] = useTransition();
    const [letter, setLetter] = useState<string | null>(null);

    return (
        <Card>
            <CardHeader title="AI tools" />
            <CardBody className="flex flex-col gap-2">
                <span className="text-sm font-medium text-secondary">Cover letter</span>
                <Button
                    color="secondary"
                    size="sm"
                    iconLeading={Stars02}
                    isLoading={pending}
                    showTextWhileLoading
                    isDisabled={pending}
                    onClick={() =>
                        start(async () => {
                            try {
                                setLetter(await generateCoverLetter(applicationId));
                            } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Generation failed.");
                            }
                        })
                    }
                >
                    Generate tailored draft
                </Button>
            </CardBody>

            <ModalOverlay isDismissable isOpen={letter != null} onOpenChange={(o) => !o && setLetter(null)}>
                <Modal className="max-w-2xl">
                    <Dialog aria-label="Cover letter draft">
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">Cover letter draft</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setLetter(null)} aria-label="Close" />
                            </div>
                            <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-5">
                                <div className="rounded-lg bg-secondary p-4 text-sm whitespace-pre-wrap text-secondary">{letter}</div>
                                <div className="flex justify-end gap-2">
                                    <Button
                                        color="secondary"
                                        size="sm"
                                        iconLeading={Copy01}
                                        onClick={async () => {
                                            if (letter) {
                                                await navigator.clipboard.writeText(letter);
                                                toast.success("Copied to clipboard");
                                            }
                                        }}
                                    >
                                        Copy
                                    </Button>
                                    <Button color="primary" size="sm" onClick={() => setLetter(null)}>
                                        Done
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </Card>
    );
}
