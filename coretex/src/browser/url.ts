function inputHost(value: string): string | null {
    const authority = value.split(/[/?#]/, 1)[0] ?? "";
    const bracketed = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/i.exec(authority);
    if (bracketed) return bracketed[1]?.toLowerCase() ?? null;
    const host = authority.replace(/:\d{1,5}$/, "");
    return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(host) ? host.toLowerCase() : null;
}

function ipv4Octets(host: string): number[] | null {
    const octets = host.split(".");
    if (octets.length !== 4 || !octets.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) {
        return null;
    }
    return octets.map(Number);
}

function isPrivateIpv4(host: string): boolean {
    const octets = ipv4Octets(host);
    if (!octets) return false;
    const [first = -1, second = -1] = octets;
    return first === 0
        || first === 10
        || first === 127
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168);
}

function isPrivateIpv6(host: string): boolean {
    return host === "::" || host === "::1" || /^f[cd][0-9a-f]:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host);
}

function isLocalHttpHost(host: string): boolean {
    return host === "localhost"
        || host.endsWith(".localhost")
        || host === "host.docker.internal"
        || host === "gateway.docker.internal"
        || host.endsWith(".local")
        // Docker/service names are commonly single-label. Exclude numeric and
        // hexadecimal spellings because WHATWG interprets those as IPv4 (for
        // example, 134744072 is public 8.8.8.8).
        || (!host.includes(".") && !/^(?:\d+|0x[0-9a-f]+)$/i.test(host))
        || isPrivateIpv4(host)
        || isPrivateIpv6(host);
}

/** Normalize user-entered browser navigation to an HTTP(S) URL. */
export function normalizeBrowserUrl(input: string): string | null {
    const value = input.trim();
    if (!value || value.length > 8192) return null;

    let candidate: string;
    if (/^https?:\/\//i.test(value)) {
        candidate = value;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        const host = inputHost(value);
        if (!host) return null;
        candidate = `${isLocalHttpHost(host) ? "http" : "https"}://${value}`;
    } else {
        const host = inputHost(value);
        candidate = `${host && isLocalHttpHost(host) ? "http" : "https"}://${value}`;
    }

    try {
        const parsed = new URL(candidate);
        if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) return null;
        if (parsed.username || parsed.password || parsed.href.length > 8192) return null;
        return parsed.href.replace(/[<>"'`]/g, (character) => encodeURIComponent(character));
    } catch {
        return null;
    }
}
