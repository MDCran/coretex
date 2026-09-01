// Shim for `next/navigation` in the Electron/Vite desktop app (there is no Next.js
// runtime here). The ported LifeOS pages were Next.js App Router pages; the desktop
// currently renders only their top-level component, so router navigation and
// redirect/notFound are stubbed to safe no-ops — enough to let these pages render
// instead of crashing on a missing module. Proper in-module navigation is future work.

export function usePathname(): string {
    return typeof window !== "undefined" ? window.location.pathname : "/";
}

export function useSearchParams(): URLSearchParams {
    return new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
}

export function useParams<T extends Record<string, string | string[]> = Record<string, string>>(): T {
    return {} as T;
}

export interface DesktopAppRouter {
    push: (href: string) => void;
    replace: (href: string) => void;
    back: () => void;
    forward: () => void;
    refresh: () => void;
    prefetch: (href: string) => void;
}

export function useRouter(): DesktopAppRouter {
    return {
        push: () => {},
        replace: () => {},
        back: () => { if (typeof window !== "undefined") window.history.back(); },
        forward: () => { if (typeof window !== "undefined") window.history.forward(); },
        refresh: () => {},
        prefetch: () => {},
    };
}

/** No-op in desktop (Next throws to halt a server render; here we just continue). */
export function redirect(_href: string, _type?: unknown): void {}
export function permanentRedirect(_href: string, _type?: unknown): void {}
export function notFound(): void {}

export enum RedirectType {
    push = "push",
    replace = "replace",
}
