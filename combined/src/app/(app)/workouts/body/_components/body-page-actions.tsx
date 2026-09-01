"use client";

import { Camera01, Ruler } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";

/**
 * Quick-action buttons for the Body & Metrics page header.
 * "Log measurement" scrolls to the inline measurement form;
 * "Add photo" navigates to the progress photos page.
 */
export function BodyPageActions() {
    const scrollToForm = () => {
        const el = document.getElementById("measurement-form");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    return (
        <div className="flex flex-wrap gap-2">
            <Button size="md" color="secondary" iconLeading={Ruler} onClick={scrollToForm}>
                Log measurement
            </Button>
            <Button size="md" color="primary" iconLeading={Camera01} href="/workouts/progress">
                Add photo
            </Button>
        </div>
    );
}
