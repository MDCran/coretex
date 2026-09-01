"use client";

import { Download01, File04, LinkExternal01, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";

export interface PreviewTarget {
    title: string;
    fileName: string;
    mimeType: string;
    previewUrl: string;
    downloadUrl: string;
}

/** Large modal that renders PDFs inline via an iframe; offers a download fallback for other types. */
export function DocumentPreviewModal({ target, onClose }: { target: PreviewTarget | null; onClose: () => void }) {
    const isPdf = target?.mimeType === "application/pdf" || target?.fileName.toLowerCase().endsWith(".pdf");

    return (
        <ModalOverlay isDismissable isOpen={target != null} onOpenChange={(v) => !v && onClose()}>
            <Modal className="h-[88vh] max-w-5xl">
                <Dialog aria-label={target ? `Preview ${target.title}` : "Preview"}>
                    <div className="flex h-[88vh] w-full flex-col overflow-hidden rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                        <div className="flex items-center justify-between gap-3 border-b border-secondary px-5 py-3">
                            <div className="min-w-0">
                                <h2 className="truncate text-md font-semibold text-primary">{target?.title}</h2>
                                <p className="truncate text-xs text-tertiary">{target?.fileName}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                {target && (
                                    <>
                                        <Button
                                            href={target.previewUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            color="secondary"
                                            size="sm"
                                            iconLeading={<LinkExternal01 data-icon className="size-4" />}
                                        >
                                            Open in new tab
                                        </Button>
                                        <Button
                                            href={target.downloadUrl}
                                            color="secondary"
                                            size="sm"
                                            iconLeading={<Download01 data-icon className="size-4" />}
                                            aria-label="Download"
                                        />
                                    </>
                                )}
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={onClose} aria-label="Close" />
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 bg-secondary">
                            {target && isPdf ? (
                                <iframe src={target.previewUrl} title={`Preview of ${target.fileName}`} className="size-full border-0" />
                            ) : (
                                <div className="flex size-full flex-col items-center justify-center gap-4 p-8 text-center">
                                    <FeaturedIcon icon={File04} color="gray" theme="light" size="lg" />
                                    <div>
                                        <p className="text-sm font-medium text-primary">No inline preview for this file type</p>
                                        <p className="mt-1 text-sm text-tertiary">{target?.mimeType || "Unknown type"} — download it to view.</p>
                                    </div>
                                    {target && (
                                        <Button href={target.downloadUrl} color="primary" iconLeading={<Download01 data-icon className="size-4" />}>
                                            Download
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
