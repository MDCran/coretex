import type { FC } from "react";
import { GradientCtaBanner, type CtaTone } from "@/components/app-shell/gradient-cta-banner";

export interface CtaDef {
    title: string;
    description: string;
    href: string;
    ctaLabel: string;
    icon: FC<{ className?: string }>;
    tone: "brand" | "success" | "warning";
}

const TONE: Record<CtaDef["tone"], CtaTone> = {
    brand: "brand",
    success: "emerald",
    warning: "amber",
};

const EYEBROW: Record<CtaDef["tone"], string> = {
    brand: "Next up",
    success: "All caught up",
    warning: "Action needed",
};

/** Single high-signal hero action chosen from the user's current state, as a gradient banner. */
export function DashboardCta({ title, description, href, ctaLabel, icon, tone }: CtaDef) {
    return (
        <GradientCtaBanner
            tone={TONE[tone]}
            eyebrow={EYEBROW[tone]}
            title={title}
            description={description}
            icon={icon}
            primary={{ label: ctaLabel, href }}
            className="group transition duration-100 ease-linear hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none [&_.size-52]:transition-transform [&_.size-52]:duration-100 [&_.size-52]:ease-linear group-hover:[&_.size-52]:scale-105 motion-reduce:[&_.size-52]:transform-none"
        />
    );
}
