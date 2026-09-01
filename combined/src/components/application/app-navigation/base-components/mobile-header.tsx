"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type PropsWithChildren, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X as CloseIcon, Menu02 } from "@untitledui/icons";
import { LifeOSLogo } from "@/components/foundations/logo/lifeos-logo";
import { cx } from "@/utils/cx";

export const MobileNavigationHeader = ({ children, actions }: PropsWithChildren<{ actions?: ReactNode }>) => {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);

    const close = useCallback(() => setOpen(false), []);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        close();
    }, [pathname, close]);

    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, close]);

    return (
        <>
            <header className="sticky top-0 z-50 flex w-full min-w-0 items-center justify-between gap-3 border-b border-secondary bg-primary px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] lg:hidden">
                <LifeOSLogo markClassName="size-6" className="shrink-0 leading-none" />

                <div className="flex min-w-0 items-center gap-0.5">
                    {actions}
                    <button
                        type="button"
                        aria-label="Open navigation menu"
                        aria-expanded={open}
                        aria-controls="mobile-navigation-drawer"
                        onClick={() => setOpen(true)}
                        className="relative z-[51] flex size-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-lg bg-primary text-fg-secondary outline-focus-ring hover:bg-primary_hover hover:text-fg-secondary_hover focus-visible:outline-2 focus-visible:outline-offset-2 active:bg-primary_hover"
                    >
                        <Menu02 aria-hidden="true" className="size-6" />
                    </button>
                </div>
            </header>

            {mounted &&
                open &&
                createPortal(
                    <div className="fixed inset-0 z-[110] flex lg:hidden" role="presentation">
                        <nav
                            id="mobile-navigation-drawer"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Navigation menu"
                            className="relative flex h-dvh w-[min(85vw,20rem)] max-w-[20rem] shrink-0 flex-col overflow-hidden bg-primary shadow-2xl ring-1 ring-secondary ring-inset"
                        >
                            <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">{children}</div>
                        </nav>

                        <button
                            type="button"
                            aria-label="Close navigation menu"
                            className="min-h-0 min-w-0 flex-1 cursor-pointer touch-manipulation bg-overlay/70 backdrop-blur-sm"
                            onClick={close}
                        />

                        <button
                            type="button"
                            aria-label="Close navigation menu"
                            onClick={close}
                            className={cx(
                                "absolute top-[max(0.75rem,env(safe-area-inset-top,0px))] right-3 z-[111]",
                                "flex size-11 cursor-pointer touch-manipulation items-center justify-center rounded-lg",
                                "text-fg-white/90 outline-focus-ring hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2",
                            )}
                        >
                            <CloseIcon aria-hidden="true" className="size-6" />
                        </button>
                    </div>,
                    document.body,
                )}
        </>
    );
};
