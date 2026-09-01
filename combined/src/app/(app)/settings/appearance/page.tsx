import { AppearanceClient } from "@/components/settings/appearance-client";
import { DateTimeSettings } from "@/components/settings/datetime-settings";

export default function SettingsAppearancePage() {
    return (
        <div className="flex flex-col gap-6">
            <AppearanceClient />
            <DateTimeSettings />
        </div>
    );
}
