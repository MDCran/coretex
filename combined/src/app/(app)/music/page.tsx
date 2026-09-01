import { MusicClient } from "@/components/music/music-client";
import { getSpotifyStatus } from "@/lib/actions/spotify";

export const dynamic = "force-dynamic";

export default async function MusicPage() {
    const status = await getSpotifyStatus();
    return <MusicClient initialStatus={status} />;
}
