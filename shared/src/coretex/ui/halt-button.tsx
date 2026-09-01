// @ts-nocheck
"use client";

// Coretex — emergency Halt control (§6). A hard stop distinct from a graceful
// Pause: aborts the in-flight LLM stream and (when the terminal layer lands)
// kills spawned processes. "Halt all" asks for confirmation; per-target does not.

import { useState } from "react";
import { SlashCircle01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

interface Props {
    onHalt: () => void;
    /** "all" requires a confirm; per-target halts immediately. */
    confirm?: boolean;
    label?: string;
    size?: "sm" | "md";
    className?: string;
}

export const HaltButton = ({ onHalt, confirm = false, label = "Halt", size = "sm", className }: Props) => {
    const [armed, setArmed] = useState(false);

    const handle = (): void => {
        if (confirm && !armed) {
            setArmed(true);
            window.setTimeout(() => setArmed(false), 3000);
            return;
        }
        setArmed(false);
        onHalt();
    };

    return (
        <Button
            size={size}
            color="secondary-destructive"
            iconLeading={SlashCircle01}
            onClick={handle}
            className={cx(className)}
        >
            {armed ? "Confirm halt" : label}
        </Button>
    );
};
