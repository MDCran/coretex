// @ts-nocheck
// Coretex — a small, extensible Fig-style command-spec database.
//
// Credit: the shape and the curated subcommand/flag sets here are inspired by and
// partially derived from withfig/autocomplete (https://github.com/withfig/autocomplete),
// which is MIT-licensed. This is a hand-trimmed, dependency-free subset — not the full
// Fig spec format — kept deliberately tiny so the terminal completion engine can ship a
// useful built-in DB without bundling the whole catalogue. Extend it by adding entries
// to SPECS (or registering one at runtime via registerSpec); getSpec(cmd) is a lazy,
// case-insensitive lookup that callers hit per keystroke.
//
// Design notes:
//   - Everything is plain data so it tree-shakes and serializes trivially.
//   - Flags carry both the long form (--verbose) and, where common, a short alias (-v).
//     The completion engine is responsible for re-styling them per shell (/flag, -Param).
//   - Subcommands may nest (git remote add ...) via `subcommands` on a Subcommand.
//   - `args` is a light hint ("a file", "a branch") used only for description text today;
//     it's a seam for argument generators later.

/** A flag/option a command (or subcommand) accepts. */
export interface SpecFlag {
    /** Canonical long form WITHOUT the leading dashes, e.g. "verbose", "no-edit". */
    name: string;
    /** Optional short alias WITHOUT the leading dash, e.g. "v". */
    short?: string;
    /** One-line description shown beside the completion. */
    description?: string;
    /** True when the flag expects a value (purely informational today). */
    takesValue?: boolean;
}

/** A subcommand (possibly nested) of a command. */
export interface Subcommand {
    name: string;
    description?: string;
    /** Flags specific to this subcommand (merged with the parent's when completing). */
    flags?: SpecFlag[];
    /** Nested subcommands (e.g. `git remote add`). */
    subcommands?: Subcommand[];
    /** Positional-arg hint, used for description text. */
    args?: string;
}

/** A top-level command spec. */
export interface CommandSpec {
    /** The executable name as typed (lowercase), e.g. "git". */
    name: string;
    description?: string;
    /** Top-level subcommands. */
    subcommands?: Subcommand[];
    /** Global flags accepted at any position. */
    flags?: SpecFlag[];
}

// ---- The DB -----------------------------------------------------------------
// Kept compact: the most-used subcommands + a representative slice of flags. The
// goal is "useful and obviously extensible", not exhaustive.

const git: CommandSpec = {
    name: "git",
    description: "the stupid content tracker",
    flags: [
        { name: "version", description: "Print the git version" },
        { name: "help", short: "h", description: "Print help" },
    ],
    subcommands: [
        { name: "status", description: "Show the working tree status", flags: [{ name: "short", short: "s", description: "Give output in short format" }, { name: "branch", short: "b", description: "Show branch information" }] },
        { name: "add", description: "Add file contents to the index", args: "a pathspec", flags: [{ name: "all", short: "A", description: "Add all changes" }, { name: "patch", short: "p", description: "Interactively choose hunks" }] },
        { name: "commit", description: "Record changes to the repository", flags: [{ name: "message", short: "m", description: "Commit message", takesValue: true }, { name: "amend", description: "Amend the previous commit" }, { name: "all", short: "a", description: "Stage all tracked changes" }, { name: "no-edit", description: "Keep the existing commit message" }] },
        { name: "push", description: "Update remote refs", flags: [{ name: "force", short: "f", description: "Force update" }, { name: "force-with-lease", description: "Safer force push" }, { name: "set-upstream", short: "u", description: "Set upstream for the branch" }, { name: "tags", description: "Push tags too" }] },
        { name: "pull", description: "Fetch from and integrate with another repo", flags: [{ name: "rebase", short: "r", description: "Rebase instead of merge" }, { name: "ff-only", description: "Only fast-forward" }] },
        { name: "fetch", description: "Download objects and refs", flags: [{ name: "all", description: "Fetch all remotes" }, { name: "prune", short: "p", description: "Prune deleted remote branches" }] },
        { name: "checkout", description: "Switch branches or restore files", flags: [{ name: "branch", short: "b", description: "Create and switch to a new branch" }, { name: "force", short: "f", description: "Force checkout" }] },
        { name: "switch", description: "Switch branches", flags: [{ name: "create", short: "c", description: "Create and switch to a new branch" }] },
        { name: "branch", description: "List, create, or delete branches", flags: [{ name: "delete", short: "d", description: "Delete a branch" }, { name: "all", short: "a", description: "List all branches" }, { name: "remotes", short: "r", description: "List remote branches" }] },
        { name: "merge", description: "Join development histories", flags: [{ name: "no-ff", description: "Always create a merge commit" }, { name: "abort", description: "Abort the current merge" }] },
        { name: "rebase", description: "Reapply commits on top of another base", flags: [{ name: "interactive", short: "i", description: "Interactive rebase" }, { name: "abort", description: "Abort the rebase" }, { name: "continue", description: "Continue after resolving conflicts" }] },
        { name: "log", description: "Show commit logs", flags: [{ name: "oneline", description: "One line per commit" }, { name: "graph", description: "Draw a text graph" }, { name: "stat", description: "Show diffstat" }] },
        { name: "diff", description: "Show changes between commits/working tree", flags: [{ name: "staged", description: "Show staged changes" }, { name: "cached", description: "Alias for --staged" }] },
        { name: "stash", description: "Stash changes in a dirty working directory", subcommands: [{ name: "push", description: "Save changes to a new stash" }, { name: "pop", description: "Apply and drop the latest stash" }, { name: "list", description: "List stashes" }, { name: "drop", description: "Remove a stash" }] },
        { name: "reset", description: "Reset current HEAD to a state", flags: [{ name: "hard", description: "Reset index and working tree" }, { name: "soft", description: "Keep index and working tree" }] },
        { name: "remote", description: "Manage tracked repositories", subcommands: [{ name: "add", description: "Add a remote", args: "name url" }, { name: "remove", description: "Remove a remote" }, { name: "-v", description: "List remotes verbosely" }] },
        { name: "clone", description: "Clone a repository into a new directory", args: "a repository" },
        { name: "init", description: "Create an empty Git repository" },
        { name: "tag", description: "Create, list, or delete tags" },
        { name: "restore", description: "Restore working tree files", flags: [{ name: "staged", description: "Unstage" }] },
    ],
};

const docker: CommandSpec = {
    name: "docker",
    description: "manage Docker containers and images",
    flags: [{ name: "version", short: "v", description: "Print version" }, { name: "help", description: "Print help" }],
    subcommands: [
        { name: "run", description: "Run a command in a new container", flags: [{ name: "detach", short: "d", description: "Run in background" }, { name: "interactive", short: "i", description: "Keep STDIN open" }, { name: "tty", short: "t", description: "Allocate a pseudo-TTY" }, { name: "rm", description: "Remove the container on exit" }, { name: "publish", short: "p", description: "Publish a port", takesValue: true }, { name: "name", description: "Assign a name", takesValue: true }, { name: "env", short: "e", description: "Set environment variables", takesValue: true }, { name: "volume", short: "v", description: "Bind mount a volume", takesValue: true }] },
        { name: "ps", description: "List containers", flags: [{ name: "all", short: "a", description: "Show all containers" }, { name: "quiet", short: "q", description: "Only show IDs" }] },
        { name: "build", description: "Build an image from a Dockerfile", flags: [{ name: "tag", short: "t", description: "Name and optionally tag", takesValue: true }, { name: "file", short: "f", description: "Name of the Dockerfile", takesValue: true }, { name: "no-cache", description: "Do not use cache" }] },
        { name: "images", description: "List images" },
        { name: "pull", description: "Pull an image from a registry", args: "an image" },
        { name: "push", description: "Push an image to a registry", args: "an image" },
        { name: "exec", description: "Run a command in a running container", flags: [{ name: "interactive", short: "i", description: "Keep STDIN open" }, { name: "tty", short: "t", description: "Allocate a pseudo-TTY" }] },
        { name: "logs", description: "Fetch the logs of a container", flags: [{ name: "follow", short: "f", description: "Follow log output" }, { name: "tail", description: "Number of lines from the end", takesValue: true }] },
        { name: "stop", description: "Stop one or more running containers" },
        { name: "start", description: "Start one or more stopped containers" },
        { name: "rm", description: "Remove one or more containers", flags: [{ name: "force", short: "f", description: "Force removal" }] },
        { name: "rmi", description: "Remove one or more images" },
        { name: "compose", description: "Define and run multi-container apps", subcommands: [{ name: "up", description: "Create and start containers", flags: [{ name: "detach", short: "d", description: "Run in background" }, { name: "build", description: "Build images before starting" }] }, { name: "down", description: "Stop and remove containers" }, { name: "logs", description: "View output from containers" }, { name: "ps", description: "List containers" }, { name: "build", description: "Build or rebuild services" }] },
    ],
};

const npmLike = (name: string): CommandSpec => ({
    name,
    description: `${name} package manager`,
    flags: [{ name: "version", short: "v", description: "Print version" }, { name: "help", short: "h", description: "Print help" }],
    subcommands: [
        { name: "install", description: "Install dependencies", flags: [{ name: "save-dev", short: "D", description: "Save to devDependencies" }, { name: "global", short: "g", description: "Install globally" }, { name: "save-exact", short: "E", description: "Save exact version" }] },
        { name: "uninstall", description: "Remove a package" },
        { name: "run", description: "Run a package script", args: "a script" },
        { name: "test", description: "Run the test script" },
        { name: "start", description: "Run the start script" },
        { name: "build", description: "Run the build script" },
        { name: "update", description: "Update packages" },
        { name: "init", description: "Create a package.json", flags: [{ name: "yes", short: "y", description: "Skip the questionnaire" }] },
        { name: "publish", description: "Publish a package" },
        { name: "exec", description: "Run a command from a package" },
        { name: "list", description: "List installed packages", flags: [{ name: "global", short: "g", description: "List global packages" }, { name: "depth", description: "Max display depth", takesValue: true }] },
        { name: "add", description: "Add a dependency (pnpm/yarn)", flags: [{ name: "dev", short: "D", description: "Add to devDependencies" }] },
        { name: "remove", description: "Remove a dependency (pnpm/yarn)" },
    ],
});

const kubectl: CommandSpec = {
    name: "kubectl",
    description: "control the Kubernetes cluster manager",
    flags: [{ name: "namespace", short: "n", description: "The namespace scope", takesValue: true }, { name: "context", description: "The kubeconfig context", takesValue: true }, { name: "output", short: "o", description: "Output format", takesValue: true }],
    subcommands: [
        { name: "get", description: "Display one or many resources", args: "a resource" },
        { name: "describe", description: "Show details of a resource" },
        { name: "apply", description: "Apply a configuration to a resource", flags: [{ name: "filename", short: "f", description: "File/dir/URL to apply", takesValue: true }] },
        { name: "delete", description: "Delete resources", flags: [{ name: "filename", short: "f", description: "File to delete from", takesValue: true }] },
        { name: "logs", description: "Print container logs", flags: [{ name: "follow", short: "f", description: "Follow the log stream" }] },
        { name: "exec", description: "Execute a command in a container", flags: [{ name: "stdin", short: "i", description: "Pass stdin" }, { name: "tty", short: "t", description: "Allocate a TTY" }] },
        { name: "create", description: "Create a resource", flags: [{ name: "filename", short: "f", description: "File to create from", takesValue: true }] },
        { name: "edit", description: "Edit a resource on the server" },
        { name: "scale", description: "Set a new size for a deployment" },
        { name: "rollout", description: "Manage the rollout of a resource", subcommands: [{ name: "status", description: "Show rollout status" }, { name: "restart", description: "Restart a resource" }, { name: "undo", description: "Undo a rollout" }] },
        { name: "config", description: "Modify kubeconfig files", subcommands: [{ name: "use-context", description: "Set the current context" }, { name: "get-contexts", description: "List contexts" }, { name: "view", description: "Show merged kubeconfig" }] },
    ],
};

const node: CommandSpec = {
    name: "node",
    description: "the Node.js runtime",
    flags: [
        { name: "version", short: "v", description: "Print the Node version" },
        { name: "eval", short: "e", description: "Evaluate the argument as script", takesValue: true },
        { name: "print", short: "p", description: "Evaluate and print the result", takesValue: true },
        { name: "inspect", description: "Activate the inspector" },
        { name: "inspect-brk", description: "Break before the user code starts" },
        { name: "experimental-vm-modules", description: "Enable experimental VM modules" },
        { name: "watch", description: "Restart on file changes" },
        { name: "help", short: "h", description: "Print help" },
    ],
};

const python: CommandSpec = {
    name: "python",
    description: "the Python interpreter",
    flags: [
        { name: "version", short: "V", description: "Print the Python version" },
        { name: "module", short: "m", description: "Run a library module as a script", takesValue: true },
        { name: "command", short: "c", description: "Execute the argument as a program", takesValue: true },
        { name: "interactive", short: "i", description: "Drop into a REPL after running" },
        { name: "help", short: "h", description: "Print help" },
    ],
};

const pip: CommandSpec = {
    name: "pip",
    description: "the Python package installer",
    flags: [{ name: "version", short: "V", description: "Print version" }, { name: "help", short: "h", description: "Print help" }],
    subcommands: [
        { name: "install", description: "Install packages", flags: [{ name: "requirement", short: "r", description: "Install from a requirements file", takesValue: true }, { name: "upgrade", short: "U", description: "Upgrade to the newest version" }, { name: "editable", short: "e", description: "Install in editable mode", takesValue: true }, { name: "user", description: "Install to the user site" }] },
        { name: "uninstall", description: "Uninstall packages", flags: [{ name: "yes", short: "y", description: "Don't ask for confirmation" }] },
        { name: "list", description: "List installed packages", flags: [{ name: "outdated", short: "o", description: "List outdated packages" }] },
        { name: "show", description: "Show information about packages" },
        { name: "freeze", description: "Output installed packages in requirements format" },
        { name: "download", description: "Download packages" },
        { name: "wheel", description: "Build wheels from requirements" },
    ],
};

const cargo: CommandSpec = {
    name: "cargo",
    description: "the Rust package manager",
    flags: [{ name: "version", short: "V", description: "Print version" }, { name: "help", short: "h", description: "Print help" }, { name: "verbose", short: "v", description: "Use verbose output" }],
    subcommands: [
        { name: "build", description: "Compile the current package", flags: [{ name: "release", short: "r", description: "Build in release mode" }, { name: "target", description: "Build for a target triple", takesValue: true }] },
        { name: "run", description: "Run a binary of the local package", flags: [{ name: "release", short: "r", description: "Run in release mode" }, { name: "bin", description: "Run the specified binary", takesValue: true }] },
        { name: "test", description: "Run the tests", flags: [{ name: "release", short: "r", description: "Test in release mode" }] },
        { name: "check", description: "Check for errors without building" },
        { name: "new", description: "Create a new cargo package", flags: [{ name: "lib", description: "Create a library package" }, { name: "bin", description: "Create a binary package" }] },
        { name: "add", description: "Add a dependency", flags: [{ name: "dev", description: "Add as a dev-dependency" }] },
        { name: "remove", description: "Remove a dependency" },
        { name: "update", description: "Update dependencies in Cargo.lock" },
        { name: "publish", description: "Upload a package to the registry" },
        { name: "clean", description: "Remove the target directory" },
        { name: "fmt", description: "Format the package's source" },
        { name: "clippy", description: "Run the Clippy linter" },
    ],
};

const ssh: CommandSpec = {
    name: "ssh",
    description: "the OpenSSH remote login client",
    flags: [
        { name: "port", short: "p", description: "Port to connect to", takesValue: true },
        { name: "identity", short: "i", description: "Identity (private key) file", takesValue: true },
        { name: "login", short: "l", description: "Login name", takesValue: true },
        { name: "verbose", short: "v", description: "Verbose mode" },
        { name: "config", short: "F", description: "Per-user config file", takesValue: true },
        { name: "forward", short: "L", description: "Local port forwarding", takesValue: true },
        { name: "tunnel", short: "N", description: "Do not execute a remote command" },
        { name: "agent", short: "A", description: "Enable agent forwarding" },
    ],
};

/** The built-in spec map, keyed by lowercase command name. Extend by adding entries. */
const SPECS: Record<string, CommandSpec> = {
    git,
    docker,
    npm: npmLike("npm"),
    pnpm: npmLike("pnpm"),
    yarn: npmLike("yarn"),
    kubectl,
    node,
    python: python,
    python3: { ...python, name: "python3" },
    pip,
    pip3: { ...pip, name: "pip3" },
    cargo,
    ssh,
};

/** Runtime-registered specs (host or plugins can add more without editing this file). */
const RUNTIME: Record<string, CommandSpec> = {};

/** Register or override a spec at runtime. The key is lowercased. */
export function registerSpec(spec: CommandSpec): void {
    RUNTIME[spec.name.toLowerCase()] = spec;
}

/** Lazy, case-insensitive lookup of a command spec by the first token. */
export function getSpec(cmd: string): CommandSpec | undefined {
    if (!cmd) return undefined;
    const key = cmd.toLowerCase();
    return RUNTIME[key] ?? SPECS[key];
}

/** The set of commands we have built-in specs for (used by callers for quick membership tests). */
export function hasSpec(cmd: string): boolean {
    return getSpec(cmd) !== undefined;
}

/**
 * Resolve a chain of already-typed tokens (after the command) to the deepest matching
 * subcommand, returning the flags available at that point (parent + subcommand) and the
 * remaining subcommands that can still be completed. `tokens` are the words AFTER the
 * command name that are NOT the active (partial) token.
 */
export function resolveSpecPath(
    spec: CommandSpec,
    tokens: string[],
): { flags: SpecFlag[]; subcommands: Subcommand[] } {
    let flags: SpecFlag[] = [...(spec.flags ?? [])];
    let subs: Subcommand[] = spec.subcommands ?? [];
    for (const tok of tokens) {
        if (tok.startsWith("-")) continue; // flags don't change the subcommand cursor
        const match = subs.find((s) => s.name === tok);
        if (!match) break;
        if (match.flags) flags = [...flags, ...match.flags];
        subs = match.subcommands ?? [];
    }
    return { flags, subcommands: subs };
}
