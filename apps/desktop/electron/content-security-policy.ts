/**
 * Renderer CSP. Development needs Vite's inline React Refresh preamble and
 * arbitrary localhost ports; packaged builds use a narrower policy.
 */
export function desktopContentSecurityPolicy(development: boolean): string {
    const scriptSource = development ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
    const connectSource = development
        ? "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://api.github.com"
        : "connect-src 'self' ws://localhost:8765 ws://127.0.0.1:8765 https://api.github.com";

    return [
        "default-src 'self'",
        scriptSource,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: coretex-asset: https: http://localhost:* http://127.0.0.1:*",
        "media-src 'self' data: blob: coretex-asset: https: http://localhost:* http://127.0.0.1:*",
        "font-src 'self' data:",
        connectSource,
        "worker-src 'self' blob:",
        "frame-src http: https:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join("; ");
}
