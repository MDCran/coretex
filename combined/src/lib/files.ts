/** Builds the same-origin URL for displaying/downloading a stored file. Safe in client and server components. */
export function fileUrl(key: string, opts?: { download?: boolean; name?: string }) {
    const params = new URLSearchParams({ key });
    if (opts?.download) params.set("download", "1");
    if (opts?.name) params.set("name", opts.name);
    return `/api/files?${params.toString()}`;
}
