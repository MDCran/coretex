// @ts-nocheck
"use client";

// Coretex — the editor surface. Monaco (MIT, the engine behind VS Code) themed to
// the Coretex tokens. Only the editor component is used; none of VS Code's
// workbench UI/CSS. Chrome around it is Untitled UI.

import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useTheme } from "../theme";

const EXT_LANG: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    json: "json", md: "markdown", css: "css", scss: "scss", html: "html", py: "python", go: "go", rs: "rust",
    java: "java", c: "c", cpp: "cpp", h: "cpp", cs: "csharp", rb: "ruby", php: "php", sh: "shell", bash: "shell",
    yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", sql: "sql", xml: "xml", svg: "xml", dockerfile: "dockerfile",
};

export function languageFromPath(path?: string): string {
    if (!path) return "plaintext";
    const base = path.split(/[\\/]/).pop() ?? "";
    if (base.toLowerCase() === "dockerfile") return "dockerfile";
    const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
    return EXT_LANG[ext] ?? "plaintext";
}

interface Props {
    path?: string;
    value: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
    wordWrap?: boolean;
    fontSize?: number;
    minimap?: boolean;
}

export const CoretexMonaco = ({ path, value, onChange, readOnly, wordWrap, fontSize, minimap }: Props) => {
    const { resolved } = useTheme();
    const themeName = resolved === "dark" ? "coretex-dark" : "coretex-light";

    const beforeMount: BeforeMount = (monaco) => {
        monaco.editor.defineTheme("coretex-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: {
                "editor.background": "#0A0C10",
                "editor.foreground": "#F5F6F8",
                "editorLineNumber.foreground": "#646A73",
                "editorLineNumber.activeForeground": "#9BA0A8",
                "editor.selectionBackground": "#2A1414",
                "editor.lineHighlightBackground": "#14171D",
                "editorCursor.foreground": "#F8A2A2",
                "editorWidget.background": "#14171D",
                "editorWidget.border": "#232830",
                "input.background": "#14171D",
                "dropdown.background": "#14171D",
                "editorGutter.background": "#0A0C10",
            },
        });
        monaco.editor.defineTheme("coretex-light", {
            base: "vs",
            inherit: true,
            rules: [],
            colors: {
                "editor.background": "#FFFFFF",
                "editor.foreground": "#101828",
                "editor.lineHighlightBackground": "#F2F4F7",
                "editor.selectionBackground": "#FEF2F2",
                "editorCursor.foreground": "#D02F2F",
            },
        });
    };

    const onMount: OnMount = (_editor, monaco) => {
        monaco.editor.setTheme(themeName);
    };

    return (
        <Editor
            key={path ?? "untitled"}
            height="100%"
            theme={themeName}
            language={languageFromPath(path)}
            value={value}
            beforeMount={beforeMount}
            onMount={onMount}
            onChange={(v) => onChange?.(v ?? "")}
            loading={<div className="flex h-full items-center justify-center text-sm text-tertiary">Loading editor…</div>}
            options={{
                readOnly,
                minimap: { enabled: minimap ?? false },
                fontSize: fontSize ?? 13,
                wordWrap: wordWrap ? "on" : "off",
                fontFamily: "JetBrains Mono, ui-monospace, monospace",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                smoothScrolling: true,
                tabSize: 4,
                renderWhitespace: "selection",
                padding: { top: 12 },
            }}
        />
    );
};
