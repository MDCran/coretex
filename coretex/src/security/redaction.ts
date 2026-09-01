const REDACTED = "[REDACTED]";

/** Event types that intentionally return secrets to their dedicated local management UI. */
const SECRET_MANAGEMENT_EVENTS = new Set(["env:state", "keyvault:state"]);

const SENSITIVE_FIELD = /^(?:api[-_]?key|authorization|cookie|keyvalue|password|passwd|refresh[-_]?token|secret|token)$/i;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactCredentialPatterns(value: string): string {
    return value
        .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`)
        .replace(/\b(Basic\s+)[A-Za-z0-9+/=]{8,}/gi, `$1${REDACTED}`)
        .replace(/([?&](?:api[-_]?key|access[-_]?token|auth|password|secret|token)=)[^&#\s]+/gi, `$1${REDACTED}`)
        .replace(/((?:api[-_]?key|authorization|cookie|keyvalue|password|passwd|refresh[-_]?token|secret|token)\s*[:=]\s*["']?)[^\s,"'}]+/gi, `$1${REDACTED}`)
        .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/@]+(@)/gi, `$1${REDACTED}$2`);
}

export type SecretValueSource = () => Iterable<string>;

/** Credentials injected into the Brain process are protected even when not persisted by Coretex. */
export function processEnvironmentSecretValues(environment: NodeJS.ProcessEnv = process.env): string[] {
    return Object.entries(environment)
        .filter(([name, value]) =>
            typeof value === "string" && value.length > 0 &&
            /(?:api_?key|auth|cookie|credential|pass(?:word|wd)?|private_?key|secret|token)/i.test(name),
        )
        .map(([, value]) => value as string);
}

/**
 * Redacts known local secret values and common credential-shaped text at the
 * process/output boundary. The enable predicate is evaluated per call so the
 * Security toggle takes effect without a restart.
 */
export class SecretRedactor {
    constructor(
        private readonly enabled: () => boolean,
        private readonly sources: SecretValueSource[],
    ) {}

    isEnabled(): boolean {
        return this.enabled();
    }

    protectedValueCount(): number {
        return this.knownValues().length;
    }

    redactText(value: string): string {
        if (!this.isEnabled() || value.length === 0) return value;
        return this.redactTextWithKnownValues(value, this.knownValues());
    }

    private redactTextWithKnownValues(value: string, knownValues: readonly string[]): string {
        let result = value;
        for (const secret of knownValues) {
            result = result.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
        }
        return redactCredentialPatterns(result);
    }

    redactValue<T>(value: T): T {
        if (!this.isEnabled()) return value;
        // Secret sources can read encrypted stores and process state. Resolve them
        // once for this top-level value, then reuse the same snapshot throughout
        // the recursive walk. Large table responses otherwise multiplied that work
        // by every string cell and could stall the local WebSocket for seconds.
        const knownValues = this.knownValues();
        return this.walk(value, new WeakMap<object, unknown>(), knownValues) as T;
    }

    /** Preserve the dedicated local secret-manager payloads; sanitize all other output. */
    redactOutboundEvent<T extends { type?: string }>(event: T): T {
        if (!this.isEnabled() || (event.type && SECRET_MANAGEMENT_EVENTS.has(event.type))) return event;
        return this.redactValue(event);
    }

    private knownValues(): string[] {
        const values = new Set<string>();
        for (const source of this.sources) {
            try {
                for (const value of source()) {
                    if (typeof value === "string" && value.length >= 4) values.add(value);
                }
            } catch {
                // A redaction source must never break output delivery.
            }
        }
        return [...values].sort((a, b) => b.length - a.length);
    }

    private walk(value: unknown, seen: WeakMap<object, unknown>, knownValues: readonly string[], fieldName?: string): unknown {
        if (typeof value === "string") {
            if (fieldName && SENSITIVE_FIELD.test(fieldName)) return REDACTED;
            return this.redactTextWithKnownValues(value, knownValues);
        }
        if (value === null || typeof value !== "object") return value;
        if (value instanceof Date) return new Date(value.getTime());
        if (value instanceof Error) {
            const message = this.redactTextWithKnownValues(value.message, knownValues);
            const copy = new Error(message);
            copy.name = value.name;
            if (value.stack) copy.stack = this.redactTextWithKnownValues(value.stack, knownValues);
            return copy;
        }
        const existing = seen.get(value);
        if (existing !== undefined) return existing;
        if (Array.isArray(value)) {
            const output: unknown[] = [];
            seen.set(value, output);
            for (const item of value) output.push(this.walk(item, seen, knownValues));
            return output;
        }
        const output: Record<string, unknown> = {};
        seen.set(value, output);
        for (const [key, item] of Object.entries(value)) {
            output[key] = this.walk(item, seen, knownValues, key);
        }
        return output;
    }
}

/** Redact all console output while the returned disposer remains installed. */
export function installConsoleRedaction(redactor: SecretRedactor): () => void {
    const methods = ["debug", "error", "info", "log", "warn"] as const;
    const originals = new Map<(typeof methods)[number], (...args: unknown[]) => void>();
    for (const method of methods) {
        const original = console[method].bind(console) as (...args: unknown[]) => void;
        originals.set(method, original);
        console[method] = ((...args: unknown[]): void => {
            original(...args.map((arg) => redactor.redactValue(arg)));
        }) as typeof console[typeof method];
    }
    return (): void => {
        for (const method of methods) {
            const original = originals.get(method);
            if (original) console[method] = original as typeof console[typeof method];
        }
    };
}

export { REDACTED };
