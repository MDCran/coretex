"use client";

import Link from "next/link";
import { ArrowLeft, Calendar, Home01, LayoutGrid01 } from "@untitledui/icons";
import { useRouter } from "next/navigation";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";

export default function NotFound() {
    const router = useRouter();

    return (
        <section className="flex min-h-screen items-center justify-center bg-primary px-4 py-16">
            <div className="flex w-full max-w-lg flex-col items-center gap-8 text-center">
                <FeaturedIcon icon={LayoutGrid01} color="brand" theme="gradient" size="xl" />
                <div className="flex flex-col gap-3">
                    <span className="text-sm font-semibold text-brand-secondary">404 — Page not found</span>
                    <h1 className="text-display-sm font-semibold text-primary sm:text-display-md">We can&apos;t find that page</h1>
                    <p className="text-md text-tertiary">
                        The link may be broken, or the page may have moved. Head back to your dashboard to pick up where you left off.
                    </p>
                </div>
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
                    <Button href="/dashboard" size="lg" iconLeading={Home01}>
                        Go to dashboard
                    </Button>
                    <Button color="secondary" size="lg" iconLeading={ArrowLeft} onClick={() => router.back()}>
                        Go back
                    </Button>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
                    <Link href="/calendar" className="inline-flex items-center gap-1.5 font-medium text-brand-secondary hover:underline">
                        <Calendar className="size-4" aria-hidden="true" />
                        Calendar
                    </Link>
                    <Link href="/todos" className="font-medium text-brand-secondary hover:underline">
                        Todos
                    </Link>
                    <Link href="/financial" className="font-medium text-brand-secondary hover:underline">
                        Financial
                    </Link>
                    <Link href="/settings" className="font-medium text-brand-secondary hover:underline">
                        Settings
                    </Link>
                </div>
            </div>
        </section>
    );
}
