// Coretex — LOCAL-ONLY secret leak scanner. Walks the user's indexed locations, reads text
// files, finds key-shaped tokens, and matches them against the vault's stored key values to
// flag "a real key of yours is sitting in plaintext in your own code" (critical) vs an
// untracked secret-shaped token (warning). Secrets NEVER leave the machine — findings carry
// only a masked preview + file:line. This is the honest alternative to "scan the dark web".

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { LeakFinding, LeakScanResult } from "../types.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "$recycle.bin", "system volume information", ".cache", "dist", "build", ".next", "out", "coverage", "vendor"]);
const MAX_FILES = 20_000;
const BUDGET_MS = 120_000;
const MAX_FILE_BYTES = 1024 * 1024;
const TEXT_EXTS = new Set(["env", "txt", "md", "json", "yaml", "yml", "js", "ts", "tsx", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "rb", "php", "sh", "bash", "zsh", "cfg", "conf", "ini", "toml", "xml", "html", "css", "sql", "properties", "tf", "tfvars", "gradle", "dockerfile"]);
const NUL = String.fromCharCode(0);

// Key-shaped patterns (provider-prefixed tokens are far less noisy than generic entropy).
const PATTERNS: { name: string; re: RegExp }[] = [
    { name: "anthropic", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
    { name: "openai", re: /sk-[A-Za-z0-9]{20,}/g },
    { name: "github", re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
    { name: "aws", re: /AKIA[0-9A-Z]{16}/g },
    { name: "stripe", re: /sk_(?:live|test)_[A-Za-z0-9]{16,}/g },
    { name: "google", re: /AIza[0-9A-Za-z_-]{35}/g },
    { name: "slack", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
    { name: "sendgrid", re: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
];

function mask(s: string): string {
    return s.length <= 8 ? "*".repeat(s.length) : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Scan `locations` for leaked/secret-shaped tokens. `vaultKeys` carries each stored key's value
 * for exact-match (used only in-process for comparison; never placed in a finding).
 */
export async function scanLeaks(
    locations: string[],
    vaultKeys: { id: string; name: string; value: string }[],
    onProgress: (scanned: number, current: string) => void,
): Promise<LeakScanResult> {
    const findings: LeakFinding[] = [];
    const byValue = new Map(vaultKeys.filter((k) => k.value && k.value.length >= 12).map((k) => [k.value, k]));
    const seen = new Set<string>();
    let scanned = 0;
    const deadline = Date.now() + BUDGET_MS;
    let lastTick = 0;

    const scanFile = async (abs: string): Promise<void> => {
        const lower = abs.toLowerCase();
        const ext = (abs.split(".").pop() ?? "").toLowerCase();
        if (!TEXT_EXTS.has(ext) && !/(^|[/\\])\.env(\.[^/\\]*)?$/.test(lower)) return;
        let s;
        try {
            s = await stat(abs);
        } catch {
            return;
        }
        if (!s.isFile() || s.size === 0 || s.size > MAX_FILE_BYTES) return;
        let text;
        try {
            text = await readFile(abs, "utf8");
        } catch {
            return;
        }
        if (text.includes(NUL)) return; // binary
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            for (const p of PATTERNS) {
                p.re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = p.re.exec(lines[i])) !== null) {
                    const val = m[0];
                    const k = `${abs}:${i}:${val.slice(0, 10)}`;
                    if (seen.has(k)) continue;
                    seen.add(k);
                    const matched = byValue.get(val);
                    findings.push({
                        file: abs,
                        line: i + 1,
                        matchPreview: mask(val),
                        matchedKeyId: matched?.id,
                        matchedKeyName: matched?.name,
                        severity: matched ? "critical" : "warning",
                    });
                }
            }
        }
    };

    const walk = async (dir: string): Promise<void> => {
        if (scanned >= MAX_FILES || Date.now() > deadline) return;
        let dirents;
        try {
            dirents = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const d of dirents) {
            if (scanned >= MAX_FILES || Date.now() > deadline) return;
            const full = path.join(dir, d.name);
            if (d.isDirectory()) {
                if (!SKIP_DIRS.has(d.name.toLowerCase()) && !d.name.startsWith(".")) await walk(full);
            } else {
                scanned += 1;
                const now = Date.now();
                if (now - lastTick > 300) {
                    lastTick = now;
                    onProgress(scanned, full);
                }
                await scanFile(full);
            }
        }
    };

    for (const loc of locations) await walk(path.resolve(loc));
    return { scanned, findings, finishedAt: Date.now() };
}
