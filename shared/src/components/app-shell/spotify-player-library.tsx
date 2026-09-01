// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import {
    ArrowLeft,
    ChevronRight,
    Heart,
    LayoutGrid01,
    MusicNote01,
    PlayCircle,
    Plus,
    Rows03,
    SearchMd,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import {
    fetchPlaylistTracks,
    fetchPlaylists,
    fetchQueue,
    fetchRecentlyPlayed,
    playerAddToQueue,
    playerPlayPlaylistFromTrack,
    playerPlayTrack,
    searchSpotifyCatalog,
    searchTrackInPlaylists,
    type TrackInPlaylistsResult,
} from "@/lib/actions/spotify";
import {
    LIKED_SONGS_PLAYLIST_ID,
    type PlaylistSummary,
    type PlaylistTrack,
    type QueueState,
    type RecentlyPlayedItem,
    type TrackSearchHit,
} from "@/lib/spotify-shared";
import {
    GRID_COLUMNS_MAX,
    GRID_COLUMNS_MIN,
    loadGridColumns,
    loadPlaylistViewMode,
    saveGridColumns,
    savePlaylistViewMode,
    type PlaylistViewMode,
} from "@/components/app-shell/spotify-player-widget-hooks";

export type LibraryView =
    | { kind: "browse" }
    | { kind: "tracks"; playlist: PlaylistSummary }
    | { kind: "search"; query: string; selectedUri?: string }
    | { kind: "spotify-catalog"; query: string };

type LibraryTab = "playlists" | "queue" | "history";

const QUEUE_POLL_MS = 5000;

function fmtDuration(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDateAdded(iso: string | null | undefined): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtPlayedAt(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
        d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Today ${time}`;
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export function PlaylistArt({ playlist, className }: { playlist: PlaylistSummary; className?: string }) {
    const liked = playlist.id === LIKED_SONGS_PLAYLIST_ID;
    return (
        <div className={cx("shrink-0 overflow-hidden rounded-md bg-secondary ring-1 ring-secondary ring-inset", className)}>
            {liked ? (
                <div className="flex size-full items-center justify-center bg-brand-solid">
                    <Heart className="size-[42%] min-h-4 min-w-4 fill-current text-fg-white" aria-hidden="true" />
                </div>
            ) : playlist.coverArt ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={playlist.coverArt} alt="" className="size-full object-cover" />
            ) : (
                <div className="flex size-full items-center justify-center">
                    <MusicNote01 className="size-4 text-fg-quaternary" aria-hidden="true" />
                </div>
            )}
        </div>
    );
}

function PlaylistName({ playlist }: { playlist: PlaylistSummary }) {
    const liked = playlist.id === LIKED_SONGS_PLAYLIST_ID;
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            {liked && <Heart className="size-3.5 shrink-0 fill-current text-brand-secondary" aria-hidden="true" />}
            <span className="truncate">{playlist.name}</span>
        </span>
    );
}

function GridColumnsPicker({ columns, onChange }: { columns: number; onChange: (n: number) => void }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-xs text-tertiary">Cols</span>
            <div className="flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                {Array.from({ length: GRID_COLUMNS_MAX - GRID_COLUMNS_MIN + 1 }, (_, i) => GRID_COLUMNS_MIN + i).map((n) => (
                    <button
                        key={n}
                        type="button"
                        aria-label={`${n} columns`}
                        aria-pressed={columns === n}
                        onClick={() => onChange(n)}
                        className={cx(
                            "min-w-7 rounded-md px-1.5 py-1 text-xs font-medium transition",
                            columns === n ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
                        )}
                    >
                        {n}
                    </button>
                ))}
            </div>
        </div>
    );
}

function ViewModeToggle({ mode, onChange }: { mode: PlaylistViewMode; onChange: (m: PlaylistViewMode) => void }) {
    return (
        <div className="flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
            <button
                type="button"
                aria-label="List view"
                aria-pressed={mode === "list"}
                onClick={() => onChange("list")}
                className={cx(
                    "rounded-md p-1.5 transition",
                    mode === "list" ? "bg-primary text-primary shadow-xs" : "text-fg-quaternary hover:text-fg-quaternary_hover",
                )}
            >
                <Rows03 className="size-4" aria-hidden="true" />
            </button>
            <button
                type="button"
                aria-label="Grid view"
                aria-pressed={mode === "grid"}
                onClick={() => onChange("grid")}
                className={cx(
                    "rounded-md p-1.5 transition",
                    mode === "grid" ? "bg-primary text-primary shadow-xs" : "text-fg-quaternary hover:text-fg-quaternary_hover",
                )}
            >
                <LayoutGrid01 className="size-4" aria-hidden="true" />
            </button>
        </div>
    );
}

function LibraryTabs({ tab, onChange }: { tab: LibraryTab; onChange: (t: LibraryTab) => void }) {
    return (
        <div className="mobile-tab-bar shrink-0 border-b border-secondary px-2 pt-1">
            {(
                [
                    ["playlists", "Playlists"],
                    ["queue", "Queue"],
                    ["history", "History"],
                ] as const
            ).map(([id, label]) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => onChange(id)}
                    className={cx(
                        "border-b-2 px-2 pb-2 text-sm font-semibold transition",
                        tab === id
                            ? "border-brand-solid text-brand-secondary"
                            : "border-transparent text-tertiary hover:text-secondary",
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

export function LibrarySection() {
    const [tab, setTab] = useState<LibraryTab>("playlists");
    const [view, setView] = useState<LibraryView>({ kind: "browse" });

    return (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <LibraryTabs tab={tab} onChange={setTab} />
            {tab === "queue" ? (
                <QueuePanel />
            ) : tab === "history" ? (
                <HistoryPanel />
            ) : view.kind === "browse" ? (
                <PlaylistBrowser
                    onOpen={(playlist) => setView({ kind: "tracks", playlist })}
                    onSearch={(query) => setView({ kind: "search", query })}
                />
            ) : view.kind === "tracks" ? (
                <TrackList playlist={view.playlist} onBack={() => setView({ kind: "browse" })} />
            ) : view.kind === "spotify-catalog" ? (
                <SpotifyCatalogResults query={view.query} onBack={() => setView({ kind: "browse" })} />
            ) : (
                <TrackSearchResults
                    initialQuery={view.query}
                    selectedUri={view.selectedUri}
                    onBack={() => setView({ kind: "browse" })}
                    onPickMatch={(query, uri) => setView({ kind: "search", query, selectedUri: uri })}
                    onSearchSpotify={(query) => setView({ kind: "spotify-catalog", query })}
                />
            )}
        </section>
    );
}

function useQueueToQueue() {
    const [queuing, setQueuing] = useState<string | null>(null);

    async function add(uri: string) {
        setQueuing(uri);
        try {
            await playerAddToQueue(uri);
            toast.success("Added to queue");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't add to queue");
        } finally {
            setQueuing(null);
        }
    }

    return { queuing, addToQueue: add };
}

function HistoryPanel() {
    const [items, setItems] = useState<RecentlyPlayedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [afterCursor, setAfterCursor] = useState<number | undefined>();
    const [playing, setPlaying] = useState<string | null>(null);
    const [needsReconnect, setNeedsReconnect] = useState(false);
    const { queuing, addToQueue } = useQueueToQueue();

    const load = useCallback(async (after?: number, append = false) => {
        setLoading(true);
        try {
            const page = await fetchRecentlyPlayed(after);
            setNeedsReconnect(false);
            setItems((prev) => (append ? [...prev, ...page.items] : page.items));
            setHasMore(page.next);
            setAfterCursor(page.after);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "";
            if (msg.includes("403") || msg.toLowerCase().includes("scope")) {
                setNeedsReconnect(true);
            } else {
                toast.error(msg || "Couldn't load listening history");
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function onPlay(uri: string) {
        setPlaying(uri);
        try {
            await playerPlayTrack(uri);
            toast.success("Playing");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't play track");
        } finally {
            setPlaying(null);
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {needsReconnect ? (
                    <p className="px-2 py-4 text-sm text-tertiary">
                        Reconnect Spotify in{" "}
                        <a href="/settings/integrations" className="font-medium text-brand-secondary hover:underline">
                            Settings → Integrations
                        </a>{" "}
                        to enable listening history.
                    </p>
                ) : loading && items.length === 0 ? (
                    <p className="px-2 py-4 text-sm text-tertiary">Loading history…</p>
                ) : items.length === 0 ? (
                    <p className="px-2 py-4 text-sm text-tertiary">No recent plays yet. Listen on Spotify and check back.</p>
                ) : (
                    <>
                        <div className="flex flex-col gap-0.5 sm:hidden">
                            {items.map((entry, index) => {
                                const t = entry.track;
                                const meta = [t.album, fmtPlayedAt(entry.playedAt), fmtDuration(t.durationMs)].filter(Boolean).join(" · ");
                                return (
                                    <TrackCard
                                        key={`${entry.playedAt}-${t.uri}-${index}`}
                                        track={t}
                                        compact
                                        subtitle={meta}
                                        playing={playing === t.uri}
                                        onPlay={() => void onPlay(t.uri)}
                                        onQueue={() => void addToQueue(t.uri)}
                                        queuing={queuing === t.uri}
                                    />
                                );
                            })}
                        </div>
                        <div className="hidden min-w-0 sm:block sm:overflow-x-auto">
                            <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                                <thead>
                                    <tr className="border-b border-secondary text-xs font-semibold tracking-wide text-tertiary uppercase">
                                        <th className="px-2 py-2 font-semibold" scope="col">
                                            Title
                                        </th>
                                        <th className="hidden px-2 py-2 font-semibold sm:table-cell" scope="col">
                                            Album
                                        </th>
                                        <th className="hidden px-2 py-2 font-semibold md:table-cell" scope="col">
                                            Played
                                        </th>
                                        <th className="w-14 px-2 py-2 text-right font-semibold" scope="col">
                                            Length
                                        </th>
                                        <th className="w-24 px-2 py-2" scope="col">
                                            <span className="sr-only">Actions</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((entry, index) => {
                                        const t = entry.track;
                                        return (
                                            <tr
                                                key={`${entry.playedAt}-${t.uri}-${index}`}
                                                className="group border-b border-secondary/60 transition hover:bg-secondary_hover"
                                            >
                                                <td className="px-2 py-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => void onPlay(t.uri)}
                                                        disabled={playing === t.uri}
                                                        className="flex w-full min-w-0 items-center gap-3 text-left disabled:opacity-50"
                                                    >
                                                        <div className="size-10 shrink-0 overflow-hidden rounded-md bg-secondary ring-1 ring-secondary ring-inset">
                                                            {t.albumArt ? (
                                                                // eslint-disable-next-line @next/next/no-img-element
                                                                <img src={t.albumArt} alt="" className="size-full object-cover" />
                                                            ) : (
                                                                <div className="flex size-full items-center justify-center">
                                                                    <MusicNote01 className="size-4 text-fg-quaternary" aria-hidden="true" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="truncate font-medium text-primary">{t.name}</p>
                                                            <p className="truncate text-xs text-tertiary">{t.artists}</p>
                                                        </div>
                                                    </button>
                                                </td>
                                                <td className="hidden max-w-[10rem] truncate px-2 py-2 text-tertiary sm:table-cell">
                                                    {t.album || "—"}
                                                </td>
                                                <td className="hidden whitespace-nowrap px-2 py-2 text-tertiary md:table-cell">
                                                    {fmtPlayedAt(entry.playedAt)}
                                                </td>
                                                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-tertiary">
                                                    {fmtDuration(t.durationMs)}
                                                </td>
                                                <td className="px-2 py-2">
                                                    <div className="flex items-center justify-end gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                                                        <Button
                                                            size="sm"
                                                            color="secondary"
                                                            iconLeading={Plus}
                                                            aria-label="Add to queue"
                                                            isLoading={queuing === t.uri}
                                                            onClick={() => void addToQueue(t.uri)}
                                                        >
                                                            <span className="hidden lg:inline">Queue</span>
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            color="tertiary"
                                                            iconLeading={PlayCircle}
                                                            aria-label="Play"
                                                            isDisabled={playing === t.uri}
                                                            onClick={() => void onPlay(t.uri)}
                                                        />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {hasMore && (
                            <Button
                                size="sm"
                                color="link-gray"
                                onClick={() => void load(afterCursor, true)}
                                isLoading={loading}
                                className="mx-2 mt-2 self-start"
                            >
                                Load more
                            </Button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function QueuePanel() {
    const [queue, setQueue] = useState<QueueState | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (showError = false) => {
        try {
            const q = await fetchQueue();
            setQueue(q);
        } catch (e) {
            if (showError) toast.error(e instanceof Error ? e.message : "Couldn't load queue");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
        const id = setInterval(() => void load(), QUEUE_POLL_MS);
        return () => clearInterval(id);
    }, [load]);

    const upcoming = queue?.queue ?? [];
    const current = queue?.currentlyPlaying;

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {loading && !queue ? (
                    <p className="px-2 py-4 text-sm text-tertiary">Loading queue…</p>
                ) : !current && upcoming.length === 0 ? (
                    <p className="px-2 py-4 text-sm text-tertiary">Queue is empty. Search for a song and tap Queue to add tracks.</p>
                ) : (
                    <div className="flex flex-col gap-3">
                        {current && (
                            <div>
                                <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-tertiary uppercase">Now playing</p>
                                <TrackCard track={current} subtitle="Currently playing" />
                            </div>
                        )}
                        {upcoming.length > 0 && (
                            <div>
                                <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-tertiary uppercase">
                                    Up next ({upcoming.length})
                                </p>
                                <div className="flex flex-col gap-0.5">
                                    {upcoming.map((t, i) => (
                                        <TrackCard key={`${t.uri}-${i}`} track={t} subtitle={`#${i + 1} in queue`} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function PlaylistBrowser({
    onOpen,
    onSearch,
}: {
    onOpen: (p: PlaylistSummary) => void;
    onSearch: (query: string) => void;
}) {
    const [items, setItems] = useState<PlaylistSummary[]>([]);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<PlaylistViewMode>("list");
    const [gridColumns, setGridColumns] = useState(3);
    const [searchInput, setSearchInput] = useState("");

    useEffect(() => {
        setViewMode(loadPlaylistViewMode());
        setGridColumns(loadGridColumns());
    }, []);

    const load = useCallback(async (off: number) => {
        setLoading(true);
        try {
            const page = await fetchPlaylists(off);
            setItems((prev) => (off === 0 ? page.items : [...prev, ...page.items]));
            setHasMore(page.next);
            setOffset(off + page.items.length);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't load playlists");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load(0);
    }, [load]);

    function setMode(mode: PlaylistViewMode) {
        setViewMode(mode);
        savePlaylistViewMode(mode);
    }

    function setColumns(columns: number) {
        setGridColumns(columns);
        saveGridColumns(columns);
    }

    function submitSearch(e: React.FormEvent) {
        e.preventDefault();
        const q = searchInput.trim();
        if (!q) return;
        onSearch(q);
    }

    return (
        <div className="flex min-h-0 flex-col">
            <div className="space-y-2 px-2 pt-2 pb-2 sm:px-4 sm:pt-3">
                <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-0 flex-1">
                        <SearchMd className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-quaternary" aria-hidden="true" />
                        <input
                            type="search"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search song or artist…"
                            enterKeyHint="search"
                            className="min-h-11 w-full rounded-lg bg-primary py-2.5 pr-3 pl-10 text-base text-primary shadow-xs ring-1 ring-primary ring-inset transition placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand sm:py-2 sm:pl-9 sm:text-sm"
                        />
                    </div>
                    <Button type="submit" size="md" color="secondary" isDisabled={!searchInput.trim()} className="w-full shrink-0 sm:w-auto">
                        Search
                    </Button>
                </form>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold tracking-wide text-tertiary uppercase">Playlists</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        {viewMode === "grid" && <GridColumnsPicker columns={gridColumns} onChange={setColumns} />}
                        <ViewModeToggle mode={viewMode} onChange={setMode} />
                    </div>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {items.length === 0 && !loading ? (
                    <p className="px-2 py-3 text-sm text-tertiary">No playlists found.</p>
                ) : viewMode === "list" ? (
                    <div className="flex flex-col gap-0.5">
                        {items.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => onOpen(p)}
                                className="flex items-center gap-3 rounded-lg p-2 text-left transition hover:bg-secondary_hover"
                            >
                                <PlaylistArt playlist={p} className="size-10" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-primary">{p.name}</p>
                                    <p className="truncate text-xs text-tertiary">{p.trackCount} tracks</p>
                                </div>
                                <ChevronRight className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>
                        {items.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => onOpen(p)}
                                className="flex flex-col gap-2 rounded-lg p-2 text-left transition hover:bg-secondary_hover"
                            >
                                <PlaylistArt playlist={p} className="aspect-square w-full rounded-lg" />
                                <div className="min-w-0">
                                    <p className="line-clamp-2 text-sm font-medium text-primary">
                                        <PlaylistName playlist={p} />
                                    </p>
                                    <p className="text-xs text-tertiary">{p.trackCount} tracks</p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
                {hasMore && (
                    <Button size="sm" color="link-gray" onClick={() => void load(offset)} isLoading={loading} className="mx-2 mt-2 self-start">
                        Load more
                    </Button>
                )}
            </div>
        </div>
    );
}

function PlaylistTrackTable({
    tracks,
    playing,
    queuing,
    onPlay,
    onQueue,
    loading,
    hasMore,
    onLoadMore,
}: {
    tracks: PlaylistTrack[];
    playing: string | null;
    queuing: string | null;
    onPlay: (uri: string) => void;
    onQueue: (uri: string) => void;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
}) {
    return (
        <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                <thead>
                    <tr className="border-b border-secondary text-xs font-semibold tracking-wide text-tertiary uppercase">
                        <th className="px-2 py-2 font-semibold" scope="col">
                            Title
                        </th>
                        <th className="hidden px-2 py-2 font-semibold sm:table-cell" scope="col">
                            Album
                        </th>
                        <th className="hidden px-2 py-2 font-semibold md:table-cell" scope="col">
                            Date added
                        </th>
                        <th className="w-14 px-2 py-2 text-right font-semibold" scope="col">
                            Length
                        </th>
                        <th className="w-24 px-2 py-2" scope="col">
                            <span className="sr-only">Actions</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {tracks.map((t) => (
                        <tr key={t.id + t.uri} className="group border-b border-secondary/60 transition hover:bg-secondary_hover">
                            <td className="px-2 py-2">
                                <button
                                    type="button"
                                    onClick={() => onPlay(t.uri)}
                                    disabled={playing === t.uri}
                                    className="flex w-full min-w-0 items-center gap-3 text-left disabled:opacity-50"
                                >
                                    <div className="size-10 shrink-0 overflow-hidden rounded-md bg-secondary ring-1 ring-secondary ring-inset">
                                        {t.albumArt ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={t.albumArt} alt="" className="size-full object-cover" />
                                        ) : (
                                            <div className="flex size-full items-center justify-center">
                                                <MusicNote01 className="size-4 text-fg-quaternary" aria-hidden="true" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-primary">{t.name}</p>
                                        <p className="truncate text-xs text-tertiary">{t.artists}</p>
                                    </div>
                                </button>
                            </td>
                            <td className="hidden max-w-[10rem] truncate px-2 py-2 text-tertiary sm:table-cell">{t.album || "—"}</td>
                            <td className="hidden whitespace-nowrap px-2 py-2 text-tertiary md:table-cell">{fmtDateAdded(t.addedAt)}</td>
                            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-tertiary">{fmtDuration(t.durationMs)}</td>
                            <td className="px-2 py-2">
                                <div className="flex items-center justify-end gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                                    <Button
                                        size="sm"
                                        color="secondary"
                                        iconLeading={Plus}
                                        aria-label="Add to queue"
                                        isLoading={queuing === t.uri}
                                        onClick={() => onQueue(t.uri)}
                                    >
                                        <span className="hidden lg:inline">Queue</span>
                                    </Button>
                                    <Button
                                        size="sm"
                                        color="tertiary"
                                        iconLeading={PlayCircle}
                                        aria-label="Play"
                                        isDisabled={playing === t.uri}
                                        onClick={() => onPlay(t.uri)}
                                    />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {hasMore && (
                <Button size="sm" color="link-gray" onClick={onLoadMore} isLoading={loading} className="mx-2 mt-2 self-start">
                    Load more
                </Button>
            )}
        </div>
    );
}

function TrackCard({
    track,
    onPlay,
    playing,
    onQueue,
    queuing,
    subtitle,
    compact,
}: {
    track: { uri: string; name: string; artists: string; albumArt: string | null; album?: string; durationMs?: number };
    onPlay?: () => void;
    playing?: boolean;
    onQueue?: () => void;
    queuing?: boolean;
    subtitle?: string;
    compact?: boolean;
}) {
    const artSize = compact ? "size-10" : "size-12";

    return (
        <div className="flex w-full items-center gap-3 rounded-lg p-2 transition hover:bg-secondary_hover">
            <button
                type="button"
                onClick={onPlay}
                disabled={playing || !onPlay}
                className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
            >
                <div className={cx("shrink-0 overflow-hidden rounded-md bg-secondary ring-1 ring-secondary ring-inset", artSize)}>
                    {track.albumArt ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={track.albumArt} alt="" className="size-full object-cover" />
                    ) : (
                        <div className="flex size-full items-center justify-center">
                            <MusicNote01 className="size-5 text-fg-quaternary" aria-hidden="true" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-primary">{track.name}</p>
                    <p className="truncate text-xs text-tertiary">{track.artists}</p>
                    {subtitle && <p className="truncate text-xs text-quaternary">{subtitle}</p>}
                </div>
            </button>
            {track.durationMs != null && track.durationMs > 0 && !subtitle && (
                <span className="shrink-0 text-xs tabular-nums text-tertiary">{fmtDuration(track.durationMs)}</span>
            )}
            <div className="flex shrink-0 items-center gap-1">
                {onQueue && (
                    <Button
                        size="sm"
                        color="secondary"
                        iconLeading={Plus}
                        aria-label="Add to queue"
                        isLoading={queuing}
                        onClick={onQueue}
                    >
                        <span className="hidden sm:inline">Queue</span>
                    </Button>
                )}
                {onPlay && (
                    <Button
                        size="sm"
                        color="tertiary"
                        iconLeading={PlayCircle}
                        aria-label="Play"
                        isDisabled={playing}
                        onClick={onPlay}
                    />
                )}
            </div>
        </div>
    );
}

function SpotifyCatalogResults({ query, onBack }: { query: string; onBack: () => void }) {
    const [items, setItems] = useState<TrackSearchHit[]>([]);
    const [searchQuery, setSearchQuery] = useState(query);
    const [loading, setLoading] = useState(true);
    const [playing, setPlaying] = useState<string | null>(null);
    const { queuing, addToQueue } = useQueueToQueue();

    const runSearch = useCallback(async (q: string) => {
        setLoading(true);
        try {
            const hits = await searchSpotifyCatalog(q, 25);
            setItems(hits);
            if (hits.length === 0) toast.message("No tracks found on Spotify");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Spotify search failed");
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void runSearch(query);
    }, [query, runSearch]);

    async function onPlay(uri: string) {
        setPlaying(uri);
        try {
            await playerPlayTrack(uri);
            toast.success("Playing");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't play track");
        } finally {
            setPlaying(null);
        }
    }

    return (
        <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-secondary px-3 py-2">
                <button
                    type="button"
                    onClick={onBack}
                    aria-label="Back to playlists"
                    className="rounded-md p-1 text-fg-quaternary transition hover:bg-primary_hover hover:text-fg-quaternary_hover"
                >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                </button>
                <form
                    className="flex min-w-0 flex-1 gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void runSearch(searchQuery);
                    }}
                >
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search Spotify…"
                        className="min-w-0 flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary ring-1 ring-primary ring-inset focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
                    />
                    <Button type="submit" size="sm" color="secondary" isLoading={loading}>
                        Search
                    </Button>
                </form>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                <p className="px-2 pb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">Spotify results</p>
                {loading && items.length === 0 ? (
                    <p className="px-2 py-4 text-sm text-tertiary">Searching Spotify…</p>
                ) : items.length === 0 ? (
                    <p className="px-2 py-4 text-sm text-tertiary">No tracks found.</p>
                ) : (
                    <div className="flex flex-col gap-0.5">
                        {items.map((t) => (
                            <TrackCard
                                key={t.uri}
                                track={t}
                                onPlay={() => void onPlay(t.uri)}
                                playing={playing === t.uri}
                                onQueue={() => void addToQueue(t.uri)}
                                queuing={queuing === t.uri}
                                subtitle={t.album}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function TrackSearchResults({
    initialQuery,
    selectedUri,
    onBack,
    onPickMatch,
    onSearchSpotify,
}: {
    initialQuery: string;
    selectedUri?: string;
    onBack: () => void;
    onPickMatch: (query: string, uri: string) => void;
    onSearchSpotify: (query: string) => void;
}) {
    const [query, setQuery] = useState(initialQuery);
    const [result, setResult] = useState<TrackInPlaylistsResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [playing, setPlaying] = useState<string | null>(null);
    const { queuing, addToQueue } = useQueueToQueue();

    const runSearch = useCallback(async (q: string, uri?: string) => {
        setLoading(true);
        try {
            const r = await searchTrackInPlaylists(q, uri);
            setResult(r);
            if (!r) toast.message("No matching tracks found");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Search failed");
            setResult(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void runSearch(initialQuery, selectedUri);
    }, [initialQuery, selectedUri, runSearch]);

    async function onPlayTrack(uri: string) {
        setPlaying(uri);
        try {
            await playerPlayTrack(uri);
            toast.success("Playing");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't play track");
        } finally {
            setPlaying(null);
        }
    }

    async function onPlayInPlaylist(playlistId: string, trackUri: string) {
        setPlaying(playlistId);
        try {
            await playerPlayPlaylistFromTrack(playlistId, trackUri);
            toast.success("Playing from playlist");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't start playlist");
        } finally {
            setPlaying(null);
        }
    }

    return (
        <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-secondary px-3 py-2">
                <button
                    type="button"
                    onClick={onBack}
                    aria-label="Back to playlists"
                    className="rounded-md p-1 text-fg-quaternary transition hover:bg-primary_hover hover:text-fg-quaternary_hover"
                >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                </button>
                <form
                    className="flex min-w-0 flex-1 gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void runSearch(query);
                    }}
                >
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary ring-1 ring-primary ring-inset focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
                    />
                    <Button type="submit" size="sm" color="secondary" isLoading={loading}>
                        Search
                    </Button>
                </form>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {loading && !result ? (
                    <p className="px-2 py-4 text-sm text-tertiary">Searching…</p>
                ) : !result ? (
                    <div className="flex flex-col items-start gap-3 px-2 py-4">
                        <p className="text-sm text-tertiary">No matches in your playlists.</p>
                        <Button size="sm" color="primary" iconLeading={SearchMd} onClick={() => onSearchSpotify(query)}>
                            Search Spotify
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="rounded-xl bg-secondary_subtle p-2 ring-1 ring-inset ring-secondary">
                            <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-tertiary uppercase">Track</p>
                            <TrackCard
                                track={result.track}
                                onPlay={() => void onPlayTrack(result.track.uri)}
                                playing={playing === result.track.uri}
                                onQueue={() => void addToQueue(result.track.uri)}
                                queuing={queuing === result.track.uri}
                            />
                        </div>

                        {result.matches.length > 1 && (
                            <div>
                                <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-tertiary uppercase">Other matches</p>
                                <div className="flex flex-col gap-0.5">
                                    {result.matches
                                        .filter((m) => m.uri !== result.track.uri)
                                        .map((m) => (
                                            <button
                                                key={m.uri}
                                                type="button"
                                                onClick={() => onPickMatch(query, m.uri)}
                                                className="rounded-lg px-2 py-1.5 text-left text-sm text-secondary transition hover:bg-secondary_hover"
                                            >
                                                {m.name} — {m.artists}
                                            </button>
                                        ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-tertiary uppercase">
                                In your playlists ({result.playlists.length})
                            </p>
                            {result.playlists.length === 0 ? (
                                <div className="flex flex-col items-start gap-2 px-2 py-2">
                                    <p className="text-sm text-tertiary">This track isn&apos;t in any of your scanned playlists.</p>
                                    <Button size="sm" color="secondary" iconLeading={SearchMd} onClick={() => onSearchSpotify(query)}>
                                        Search Spotify
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-0.5">
                                    {result.playlists.map((pl) => (
                                        <button
                                            key={pl.id}
                                            type="button"
                                            disabled={playing === pl.id}
                                            onClick={() => void onPlayInPlaylist(pl.id, result.track.uri)}
                                            className="flex items-center gap-3 rounded-lg p-2 text-left transition hover:bg-secondary_hover disabled:opacity-50"
                                        >
                                            <PlaylistArt playlist={pl} className="size-10" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-primary">
                                                    <PlaylistName playlist={pl} />
                                                </p>
                                                <p className="text-xs text-tertiary">Play from this track</p>
                                            </div>
                                            <PlayCircle className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export function TrackList({ playlist, onBack }: { playlist: PlaylistSummary; onBack: () => void }) {
    const [items, setItems] = useState<PlaylistTrack[]>([]);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [playing, setPlaying] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<PlaylistViewMode>("list");
    const [gridColumns, setGridColumns] = useState(3);
    const { queuing, addToQueue } = useQueueToQueue();

    useEffect(() => {
        setViewMode(loadPlaylistViewMode());
        setGridColumns(loadGridColumns());
    }, []);

    const load = useCallback(
        async (off: number) => {
            setLoading(true);
            try {
                const page = await fetchPlaylistTracks(playlist.id, off);
                setItems((prev) => (off === 0 ? page.items : [...prev, ...page.items]));
                setHasMore(page.next);
                setOffset(off + page.items.length);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't load tracks");
            } finally {
                setLoading(false);
            }
        },
        [playlist.id],
    );

    useEffect(() => {
        void load(0);
    }, [load]);

    async function onPlay(uri: string) {
        setPlaying(uri);
        try {
            await playerPlayTrack(uri);
            toast.success("Playing");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't play track");
        } finally {
            setPlaying(null);
        }
    }

    function setMode(mode: PlaylistViewMode) {
        setViewMode(mode);
        savePlaylistViewMode(mode);
    }

    function setColumns(columns: number) {
        setGridColumns(columns);
        saveGridColumns(columns);
    }

    return (
        <div className="flex min-h-0 flex-col">
            <div className="space-y-2 px-3 pt-3 pb-2">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label="Back to playlists"
                        className="rounded-md p-1 text-fg-quaternary transition hover:bg-primary_hover hover:text-fg-quaternary_hover"
                    >
                        <ArrowLeft className="size-4" aria-hidden="true" />
                    </button>
                    <PlaylistArt playlist={playlist} className="size-8" />
                    <p className="min-w-0 flex-1 text-sm font-semibold text-primary">
                        <PlaylistName playlist={playlist} />
                    </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {viewMode === "grid" && <GridColumnsPicker columns={gridColumns} onChange={setColumns} />}
                    <ViewModeToggle mode={viewMode} onChange={setMode} />
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {items.length === 0 && !loading ? (
                    <p className="px-2 py-3 text-sm text-tertiary">No playable tracks.</p>
                ) : viewMode === "list" ? (
                    <PlaylistTrackTable
                        tracks={items}
                        playing={playing}
                        queuing={queuing}
                        onPlay={(uri) => void onPlay(uri)}
                        onQueue={(uri) => void addToQueue(uri)}
                        loading={loading}
                        hasMore={hasMore}
                        onLoadMore={() => void load(offset)}
                    />
                ) : (
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>
                        {items.map((t) => (
                            <div
                                key={t.id + t.uri}
                                className="group flex flex-col gap-2 rounded-lg p-2 transition hover:bg-secondary_hover"
                            >
                                <button
                                    type="button"
                                    onClick={() => void onPlay(t.uri)}
                                    disabled={playing === t.uri}
                                    className="flex flex-col gap-2 text-left disabled:opacity-50"
                                >
                                    <div className="aspect-square w-full overflow-hidden rounded-lg bg-secondary ring-1 ring-secondary ring-inset">
                                        {t.albumArt ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={t.albumArt} alt="" className="size-full object-cover" />
                                        ) : (
                                            <div className="flex size-full items-center justify-center">
                                                <MusicNote01 className="size-8 text-fg-quaternary" aria-hidden="true" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="line-clamp-2 text-sm font-medium text-primary">{t.name}</p>
                                        <p className="line-clamp-1 text-xs text-tertiary">{t.artists}</p>
                                        {t.album && <p className="line-clamp-1 text-xs text-quaternary">{t.album}</p>}
                                        <p className="text-xs tabular-nums text-quaternary">
                                            {fmtDuration(t.durationMs)}
                                            {t.addedAt ? ` · ${fmtDateAdded(t.addedAt)}` : ""}
                                        </p>
                                    </div>
                                </button>
                                <Button
                                    size="sm"
                                    color="secondary"
                                    className="w-full"
                                    iconLeading={Plus}
                                    onClick={() => void addToQueue(t.uri)}
                                    isLoading={queuing === t.uri}
                                >
                                    Queue
                                </Button>
                            </div>
                        ))}
                        {hasMore && (
                            <Button size="sm" color="link-gray" onClick={() => void load(offset)} isLoading={loading} className="col-span-full mx-2 mt-1 self-start">
                                Load more
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
