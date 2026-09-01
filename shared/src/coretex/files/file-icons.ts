// @ts-nocheck
// Coretex — auto icons by type, so the explorer reads like a modern IDE tree.
// Folder icons key off the folder name (material-icon-theme style); file icons
// key off the extension. Both are data-driven and extensible. Returns an
// @untitledui/icons name + an accent color; resolved to a component by ProjectIcon.

export interface AutoIcon {
    icon: string;
    color: string;
}

const FOLDER_DEFAULT: AutoIcon = { icon: "Folder", color: "#ef4242" };
const FILE_DEFAULT: AutoIcon = { icon: "File02", color: "#94a3b8" };

// Exact folder-name matches (lowercased).
const FOLDER_BY_NAME: Record<string, AutoIcon> = {
    ".git": { icon: "GitBranch01", color: "#f97316" },
    ".github": { icon: "GitBranch01", color: "#94a3b8" },
    node_modules: { icon: "Package", color: "#22c55e" },
    ".vscode": { icon: "Code02", color: "#3b82f6" },
    ".idea": { icon: "Code02", color: "#8b5cf6" },
    src: { icon: "Code02", color: "#3b82f6" },
    lib: { icon: "Code02", color: "#3b82f6" },
    app: { icon: "Code02", color: "#3b82f6" },
    components: { icon: "Box", color: "#06b6d4" },
    dist: { icon: "Box", color: "#667085" },
    build: { icon: "Box", color: "#667085" },
    out: { icon: "Box", color: "#667085" },
    target: { icon: "Box", color: "#667085" },
    public: { icon: "Globe01", color: "#0ea5e9" },
    static: { icon: "Globe01", color: "#0ea5e9" },
    assets: { icon: "Image01", color: "#ec4899" },
    images: { icon: "Image01", color: "#ec4899" },
    img: { icon: "Image01", color: "#ec4899" },
    icons: { icon: "Image01", color: "#ec4899" },
    docs: { icon: "BookOpen01", color: "#f59e0b" },
    doc: { icon: "BookOpen01", color: "#f59e0b" },
    test: { icon: "Beaker01", color: "#8b5cf6" },
    tests: { icon: "Beaker01", color: "#8b5cf6" },
    __tests__: { icon: "Beaker01", color: "#8b5cf6" },
    downloads: { icon: "Download01", color: "#3b82f6" },
    documents: { icon: "File04", color: "#667085" },
    pictures: { icon: "Image01", color: "#ec4899" },
    photos: { icon: "Image01", color: "#ec4899" },
    desktop: { icon: "Monitor01", color: "#667085" },
    music: { icon: "MusicNote01", color: "#ec4899" },
    videos: { icon: "PlayCircle", color: "#0ea5e9" },
    video: { icon: "PlayCircle", color: "#0ea5e9" },
    ".ssh": { icon: "Key01", color: "#f59e0b" },
    ".aws": { icon: "Cloud01", color: "#f97316" },
    ".docker": { icon: "Container", color: "#3b82f6" },
    ".config": { icon: "Settings01", color: "#667085" },
    config: { icon: "Settings01", color: "#667085" },
    ".coretex": { icon: "Cube01", color: "#ef4242" },
    ".next": { icon: "Box", color: "#667085" },
    ".cache": { icon: "Box", color: "#667085" },
    ".vercel": { icon: "Globe01", color: "#667085" },
};

export function folderIcon(name: string): AutoIcon {
    return FOLDER_BY_NAME[name.toLowerCase()] ?? FOLDER_DEFAULT;
}

// File extension → icon.
const FILE_BY_EXT: Record<string, AutoIcon> = {
    ts: { icon: "Code02", color: "#3b82f6" }, tsx: { icon: "Code02", color: "#3b82f6" },
    js: { icon: "Code02", color: "#f59e0b" }, jsx: { icon: "Code02", color: "#f59e0b" },
    mjs: { icon: "Code02", color: "#f59e0b" }, cjs: { icon: "Code02", color: "#f59e0b" },
    py: { icon: "Code02", color: "#3b82f6" }, go: { icon: "Code02", color: "#06b6d4" },
    rs: { icon: "Code02", color: "#f97316" }, java: { icon: "Code02", color: "#ef4444" },
    rb: { icon: "Code02", color: "#ef4444" }, php: { icon: "Code02", color: "#8b5cf6" },
    json: { icon: "FileCode02", color: "#f59e0b" }, jsonc: { icon: "FileCode02", color: "#f59e0b" },
    html: { icon: "Code02", color: "#f97316" }, css: { icon: "Palette", color: "#0ea5e9" }, scss: { icon: "Palette", color: "#ec4899" },
    md: { icon: "File04", color: "#667085" }, mdx: { icon: "File04", color: "#667085" }, txt: { icon: "File04", color: "#94a3b8" },
    pdf: { icon: "File05", color: "#ef4444" },
    png: { icon: "Image01", color: "#ec4899" }, jpg: { icon: "Image01", color: "#ec4899" }, jpeg: { icon: "Image01", color: "#ec4899" },
    gif: { icon: "Image01", color: "#ec4899" }, webp: { icon: "Image01", color: "#ec4899" }, svg: { icon: "Image01", color: "#22c55e" }, ico: { icon: "Image01", color: "#ec4899" },
    mp4: { icon: "PlayCircle", color: "#0ea5e9" }, mov: { icon: "PlayCircle", color: "#0ea5e9" }, webm: { icon: "PlayCircle", color: "#0ea5e9" }, mkv: { icon: "PlayCircle", color: "#0ea5e9" },
    mp3: { icon: "MusicNote01", color: "#ec4899" }, wav: { icon: "MusicNote01", color: "#ec4899" }, flac: { icon: "MusicNote01", color: "#ec4899" }, ogg: { icon: "MusicNote01", color: "#ec4899" },
    zip: { icon: "Package", color: "#f59e0b" }, tar: { icon: "Package", color: "#f59e0b" }, gz: { icon: "Package", color: "#f59e0b" }, tgz: { icon: "Package", color: "#f59e0b" }, "7z": { icon: "Package", color: "#f59e0b" }, rar: { icon: "Package", color: "#f59e0b" },
    db: { icon: "Database01", color: "#6366f1" }, sqlite: { icon: "Database01", color: "#6366f1" }, sql: { icon: "Database01", color: "#6366f1" },
    sh: { icon: "Terminal", color: "#22c55e" }, bash: { icon: "Terminal", color: "#22c55e" }, ps1: { icon: "Terminal", color: "#3b82f6" }, bat: { icon: "Terminal", color: "#667085" },
    yml: { icon: "Settings01", color: "#667085" }, yaml: { icon: "Settings01", color: "#667085" }, toml: { icon: "Settings01", color: "#667085" }, ini: { icon: "Settings01", color: "#667085" }, env: { icon: "Settings01", color: "#f59e0b" },
    lock: { icon: "Lock01", color: "#667085" },
    exe: { icon: "Tool01", color: "#667085" }, msi: { icon: "Tool01", color: "#667085" },
};

const FILE_BY_NAME: Record<string, AutoIcon> = {
    "package.json": { icon: "Package", color: "#22c55e" },
    "tsconfig.json": { icon: "Code02", color: "#3b82f6" },
    dockerfile: { icon: "Container", color: "#3b82f6" },
    ".gitignore": { icon: "GitBranch01", color: "#f97316" },
    ".env": { icon: "Settings01", color: "#f59e0b" },
    "readme.md": { icon: "BookOpen01", color: "#f59e0b" },
    "license": { icon: "File04", color: "#94a3b8" },
};

export function fileIcon(name: string): AutoIcon {
    const lower = name.toLowerCase();
    if (FILE_BY_NAME[lower]) return FILE_BY_NAME[lower];
    const ext = lower.includes(".") ? lower.split(".").pop()! : "";
    return FILE_BY_EXT[ext] ?? FILE_DEFAULT;
}

export function entryIcon(name: string, isDir: boolean): AutoIcon {
    return isDir ? folderIcon(name) : fileIcon(name);
}
