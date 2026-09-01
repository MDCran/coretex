"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/base/buttons/button";
import type { Props as ButtonProps } from "@/components/base/buttons/button";

/** Submit button that shows a loading spinner while the parent form is pending. */
export function SubmitButton({ children, ...props }: ButtonProps) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" isLoading={pending} showTextWhileLoading {...props}>
            {children}
        </Button>
    );
}
