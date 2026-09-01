import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

interface ProtectedLocalFile {
    version: 1;
    protection: "win32-dpapi-current-user" | "file-permissions";
    data: string;
}

export interface ProtectedStorageInfo {
    backend: ProtectedLocalFile["protection"];
    /** DPAPI encrypts the payload; the portable fallback relies on restrictive file permissions. */
    encryptedAtRest: boolean;
}

export function protectedStorageInfo(): ProtectedStorageInfo {
    return process.platform === "win32"
        ? { backend: "win32-dpapi-current-user", encryptedAtRest: true }
        : { backend: "file-permissions", encryptedAtRest: false };
}

/** Protect/unprotect a payload with Windows DPAPI without exposing it in argv. */
function runDpapi(mode: "protect" | "unprotect", input: string): Promise<string> {
    const protectScript = [
        "Add-Type -AssemblyName System.Security",
        "$value = [Console]::In.ReadToEnd()",
        "$bytes = [Text.Encoding]::UTF8.GetBytes($value)",
        "$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Console]::Out.Write([Convert]::ToBase64String($protected))",
    ].join("; ");
    const unprotectScript = [
        "Add-Type -AssemblyName System.Security",
        "$value = [Console]::In.ReadToEnd().Trim()",
        "$bytes = [Convert]::FromBase64String($value)",
        "$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
    ].join("; ");
    return new Promise((resolve, reject) => {
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", mode === "protect" ? protectScript : unprotectScript], {
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "";
        let errorOutput = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => { output += chunk; });
        child.stderr.on("data", (chunk: string) => { errorOutput += chunk; });
        child.on("error", () => reject(new Error("Windows data protection is unavailable.")));
        child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`Windows data protection failed${errorOutput.trim() ? `: ${errorOutput.trim().slice(0, 300)}` : "."}`)));
        child.stdin.end(input, "utf8");
    });
}

function isProtectedFile(value: unknown): value is ProtectedLocalFile {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<ProtectedLocalFile>;
    return item.version === 1 && typeof item.data === "string" &&
        (item.protection === "win32-dpapi-current-user" || item.protection === "file-permissions");
}

/** Read protected JSON. Legacy plaintext JSON is accepted and flagged for migration. */
export async function readProtectedJson<T>(file: string): Promise<{ value: T; needsMigration: boolean }> {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isProtectedFile(parsed)) return { value: parsed as T, needsMigration: true };
    const plain = parsed.protection === "win32-dpapi-current-user"
        ? await runDpapi("unprotect", parsed.data)
        : Buffer.from(parsed.data, "base64").toString("utf8");
    return { value: JSON.parse(plain) as T, needsMigration: false };
}

/** Atomically write JSON protected to the current Windows user (0600 fallback elsewhere). */
export async function writeProtectedJson(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const plain = JSON.stringify(value);
    const payload: ProtectedLocalFile = process.platform === "win32"
        ? { version: 1, protection: "win32-dpapi-current-user", data: await runDpapi("protect", plain) }
        : { version: 1, protection: "file-permissions", data: Buffer.from(plain, "utf8").toString("base64") };
    const temp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(temp, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temp, file);
}
