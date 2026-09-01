// Parse the command-line-shaped args field used by Settings → MCP servers.
// Supports single/double quoted values and backslash escapes without invoking a shell.
export function parseMcpArgs(input: string | undefined): string[] {
    const source = input?.trim() ?? "";
    if (!source) return [];
    const args: string[] = [];
    let current = "";
    let quote: "'" | '"' | null = null;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === "\\" && quote !== "'") {
            const next = source[index + 1];
            if (next === "\\" || next === '"' || /\s/.test(next ?? "")) {
                escaped = true;
                continue;
            }
            current += char; // preserve Windows path separators (C:\Users\...)
            continue;
        }
        if (quote) {
            if (char === quote) quote = null;
            else current += char;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current) {
                args.push(current);
                current = "";
            }
            continue;
        }
        current += char;
    }
    if (escaped) current += "\\";
    if (current) args.push(current);
    return args;
}
