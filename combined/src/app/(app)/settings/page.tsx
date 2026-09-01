import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fileUrl } from "@/lib/files";
import { ProfileClient } from "./profile-client";

export const dynamic = "force-dynamic";

export default async function SettingsProfilePage() {
    const user = await requireUser();
    const [profile, settings] = await Promise.all([
        db.userProfile.findUnique({ where: { userId: user.id } }),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);

    return (
        <ProfileClient
            user={{
                name: user.name,
                email: user.email,
                username: user.username,
                avatarUrl: user.avatarKey ? fileUrl(user.avatarKey) : null,
            }}
            profile={{
                gender: profile?.gender ?? null,
                birthdate: profile?.birthdate?.toISOString() ?? null,
                heightCm: profile?.heightCm ?? null,
                phone: profile?.phone ?? null,
            }}
            unitSystem={settings?.unitSystem ?? "IMPERIAL"}
        />
    );
}
