import { redirect } from "next/navigation";

/** Legacy path — preferences now live under Appearance and Goals. */
export default function SettingsPreferencesRedirect() {
    redirect("/settings/appearance");
}
