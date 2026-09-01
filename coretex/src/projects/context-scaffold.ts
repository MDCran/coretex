// Coretex — project context scaffolding. On first source-path assignment, provision a
// standardized `context/` folder (ARCHITECTURE / DESIGN / PRD / RULES / SCHEMA) plus root
// agent-config files (CLAUDE.md / AGENTS.md) so autonomous agents read a project's
// architecture, design tokens, requirements, engineering rules, and data model up front.
// Every writer is create-if-absent — an existing file is never overwritten.

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface ProjectMeta {
    name: string;
    description?: string;
}

async function exists(target: string): Promise<boolean> {
    try {
        await access(target);
        return true;
    } catch {
        return false;
    }
}

/** Write a file only when it does not already exist. Returns true if it created the file. */
async function writeIfAbsent(target: string, contents: string): Promise<boolean> {
    if (await exists(target)) return false;
    await writeFile(target, contents, "utf8");
    return true;
}

function architectureDoc(meta: ProjectMeta): string {
    return `# Architecture — ${meta.name}

> System overview and architectural reference. Keep this current as the design evolves;
> agents read it before making structural changes.

## Overview
${meta.description || "Describe what this system does and who it serves."}

## Design methodology
- Architectural pattern: (e.g. modular monolith, microservices, event-driven)
- Key principles guiding decomposition and boundaries

## Data flow
Describe the primary request/response and background data flows through the system.

## Components
| Component | Responsibility | Depends on |
| --- | --- | --- |
|  |  |  |

## Structural diagrams
Add or link diagrams (Mermaid, images) that show module and service relationships.
`;
}

function designDoc(meta: ProjectMeta): string {
    return `# Design — ${meta.name}

> Design tokens and brand rules. These constraints prevent generic, templated-looking
> output — agents must honor them when generating any UI.

## Brand identity
Voice, personality, and the impression the product should leave.

## Color palette
| Token | Value | Usage |
| --- | --- | --- |
| \`--brand\` |  | Primary brand color |
| \`--surface\` |  | Base surface |

## Typography
- Type scale (e.g. 12 / 14 / 16 / 20 / 24 / 32)
- Font families and weights

## Spacing
- Base spacing multiplier (e.g. 4px grid)

## Motion
- Standard transition/easing curves and durations

## Accessibility
- Target WCAG 2.1 AA (contrast, focus states, keyboard navigation, reduced-motion support)
`;
}

function prdDoc(meta: ProjectMeta): string {
    return `# Product Requirements — ${meta.name}

> Scope and success criteria. Agents anchor to this document to avoid drifting from the
> original blueprint.

## Problem & scope
${meta.description || "What problem does this solve, and what is explicitly in / out of scope?"}

## MVP feature set
- [ ] Feature 1
- [ ] Feature 2

## Long-term goals
Where this heads beyond the MVP.

## Technical requirements
Explicit constraints (platforms, performance budgets, integrations, compliance).

## Success metrics
Quantitative targets that define "done" and "working well".
`;
}

function rulesDoc(meta: ProjectMeta): string {
    return `# Engineering Rules — ${meta.name}

> Mandatory engineering standards. Agents and reviewers enforce these on every change.

## SOLID
All classes and modules adhere to SOLID principles.

## DRY
Abstract shared logic once a utility, function, or service is duplicated **4 or more times**.
Below that threshold, prefer clarity over premature abstraction.

## KISS
Prioritize the simplest maintainable solution when shipping business logic — avoid
speculative complexity.

## Branch and review protocol
- \`sandbox\`: disposable experiments and spikes.
- \`devel\`: integrated development work.
- \`staging\`: release-candidate validation.
- \`main\`: protected production history.
- \`feature/*\`: isolated task implementation branches.
- Every implementation requires two independent review passes against all files in \`context/\` before merge.

## Additional conventions
- Naming, file structure, and comment-formatting conventions specific to this project.
`;
}

function schemaDoc(meta: ProjectMeta): string {
    return `# Schema — ${meta.name}

> Database documentation: models, relationships, security policies, and migration history.

## Data models
Describe each entity and its fields.

## Entity-relationship diagram
Add an ERD (Mermaid \`erDiagram\` or image) of table relationships.

## Row-level security
Document RLS policies and access rules per table.

## Migrations
Track applied migrations and notable schema changes here.
`;
}

function claudeConfig(meta: ProjectMeta): string {
    return `# ${meta.name}

Project-level guidance for Claude Code / autonomous agents working in this repository.

## Context
Read the files in \`context/\` before starting work:
- \`context/ARCHITECTURE.md\` — system structure and data flow
- \`context/DESIGN.md\` — design tokens and brand rules (honor these for any UI)
- \`context/PRD.md\` — scope, requirements, and success metrics
- \`context/RULES.md\` — engineering standards (SOLID / DRY / KISS)
- \`context/SCHEMA.md\` — data model and migrations

## Build & test commands
Document the local build, test, and lint commands here so agents run the right ones.

## Constraints
List styling constraints and execution flags agents must respect.
`;
}

function agentsConfig(meta: ProjectMeta): string {
    return `# Agents — ${meta.name}

Operating guide for autonomous agents on this project. Mirrors \`CLAUDE.md\`; kept for
tools that look for \`AGENTS.md\`.

## Before you start
Load every file under \`context/\` and follow \`context/RULES.md\`.

## Working agreement
- Make focused changes; keep the build green.
- Match existing code style and the design tokens in \`context/DESIGN.md\`.
- Update \`context/\` docs when you change architecture or the data model.
- Work on \`feature/*\` branches and target the configured protected branch through a reviewed pull request.
- Reviewers independently inspect the diff, tests, comments, and context-document compliance.
`;
}

export interface ScaffoldResult {
    created: string[];
    skipped: string[];
}

/**
 * Provision the standardized context folder + root agent-config files under `sourcePath`.
 * Idempotent: existing files are left untouched. Failures (e.g. read-only path) are swallowed
 * by the caller — scaffolding is best-effort and never blocks project creation.
 */
export async function scaffoldProjectContext(sourcePath: string, meta: ProjectMeta): Promise<ScaffoldResult> {
    const created: string[] = [];
    const skipped: string[] = [];
    const contextDir = path.join(sourcePath, "context");
    await mkdir(contextDir, { recursive: true });

    const files: Array<{ target: string; contents: string }> = [
        { target: path.join(contextDir, "ARCHITECTURE.md"), contents: architectureDoc(meta) },
        { target: path.join(contextDir, "DESIGN.md"), contents: designDoc(meta) },
        { target: path.join(contextDir, "PRD.md"), contents: prdDoc(meta) },
        { target: path.join(contextDir, "RULES.md"), contents: rulesDoc(meta) },
        { target: path.join(contextDir, "SCHEMA.md"), contents: schemaDoc(meta) },
        { target: path.join(sourcePath, "CLAUDE.md"), contents: claudeConfig(meta) },
        { target: path.join(sourcePath, "AGENTS.md"), contents: agentsConfig(meta) },
    ];

    for (const file of files) {
        const didCreate = await writeIfAbsent(file.target, file.contents);
        (didCreate ? created : skipped).push(path.basename(file.target));
    }
    return { created, skipped };
}
