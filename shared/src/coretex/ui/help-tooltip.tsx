// @ts-nocheck
"use client";

// Coretex — the ⊙? help affordance. Drop next to any label whose effect isn't
// obvious; hover/tap opens an Untitled UI tooltip with a one-line explanation.

import { HelpCircle } from "@untitledui/icons";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { cx } from "@/utils/cx";

interface Props {
    /** Concise, plain-language explanation (one or two sentences). */
    text: string;
    title?: string;
    size?: number;
    className?: string;
}

export const HelpTooltip = ({ text, title, size = 14, className }: Props) => (
    <Tooltip title={title ?? text} description={title ? text : undefined} placement="top" delay={150}>
        <TooltipTrigger
            className={cx("inline-flex shrink-0 items-center justify-center text-quaternary transition-colors hover:text-tertiary", className)}
            aria-label="Help"
        >
            <HelpCircle style={{ width: size, height: size }} />
        </TooltipTrigger>
    </Tooltip>
);
