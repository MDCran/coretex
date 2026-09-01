"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Stars01 } from "@untitledui/icons";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Button } from "@/components/base/buttons/button";
import { CHANGELOG, LATEST_VERSION, type ChangeType } from "@/lib/changelog";
import { cx } from "@/utils/cx";

const SEEN_KEY = "lifeos.changelog.seen";

const TYPE_DOT: Record<ChangeType, string> = {
    added: "bg-success-solid",
    improved: "bg-brand-solid",
    fixed: "bg-warning-solid",
};

/** Announces the latest release once per version (tracked in localStorage). */
export function WhatsNewDialog() {
    const [open, setOpen] = useState(false);
    const latest = CHANGELOG[0];

    useEffect(() => {
        try {
            if (localStorage.getItem(SEEN_KEY) !== LATEST_VERSION) setOpen(true);
        } catch {
            /* ignore */
        }
    }, []);

    function dismiss() {
        try {
            localStorage.setItem(SEEN_KEY, LATEST_VERSION);
        } catch {
            /* ignore */
        }
        setOpen(false);
    }

    if (!latest) return null;

    return (
        <ModalOverlay isDismissable isOpen={open} onOpenChange={(o) => !o && dismiss()}>
            <Modal className="w-full max-w-lg">
                <Dialog aria-label="What's new" className="block">
                    <div className="overflow-hidden rounded-2xl bg-primary shadow-2xl ring-1 ring-secondary_alt">
                        <div className="relative overflow-hidden border-b border-secondary p-5">
                            <div
                                className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full opacity-40 blur-3xl"
                                style={{ background: "radial-gradient(circle, rgb(127 86 217 / 0.5), transparent 70%)" }}
                                aria-hidden="true"
                            />
                            <div className="relative flex items-center gap-3">
                                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-primary text-brand-secondary ring-1 ring-brand ring-inset">
                                    <Stars01 className="size-5" aria-hidden="true" />
                                </span>
                                <div>
                                    <p className="text-xs font-semibold tracking-wide text-brand-secondary uppercase">What&apos;s new · v{latest.version}</p>
                                    <h2 className="text-lg font-semibold text-primary">{latest.title}</h2>
                                </div>
                            </div>
                        </div>

                        <ul className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto p-5">
                            {latest.highlights.map((h, i) => (
                                <li key={i} className="flex items-start gap-3">
                                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", TYPE_DOT[h.type])} aria-hidden="true" />
                                    <span className="text-sm text-secondary">{h.text}</span>
                                </li>
                            ))}
                        </ul>

                        <div className="flex items-center justify-between gap-3 border-t border-secondary p-4">
                            <Link href="/changelog" onClick={dismiss} className="text-sm font-semibold text-brand-secondary transition hover:text-brand-secondary_hover">
                                Full changelog
                            </Link>
                            <Button onClick={dismiss}>Got it</Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
