// Coretex — environment variable manager. Projects → environments → variables,
// each variable tied to a company (LogoKit) + a use-category. Persists to
// ~/.coretex/envmanager.json. Ships EMPTY — every variable here is one the user
// added. The complete payload is protected at rest because it contains values.

import path from "node:path";
import type { EnvManagerState, EnvVariable, Environment } from "../types.js";
import { readProtectedJson, writeProtectedJson } from "../security/protected-file.js";

function genId(p: string): string {
    return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export class EnvManagerStore {
    private environments: Environment[] = [];
    private readonly file: string;

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "envmanager.json");
    }

    async load(): Promise<void> {
        // No fabricated demo secrets — start empty and let the user create environments + variables.
        let migrate = false;
        try {
            const loaded = await readProtectedJson<{ environments?: Environment[] }>(this.file);
            const raw = loaded.value;
            migrate = loaded.needsMigration;
            this.environments = Array.isArray(raw.environments) ? raw.environments : [];
        } catch {
            this.environments = [];
        }
        if (migrate) await this.save();
    }

    state(): EnvManagerState {
        return { environments: this.environments.slice() };
    }

    async upsertEnvironment(env: Environment): Promise<void> {
        const idx = this.environments.findIndex((e) => e.id === env.id);
        env.updatedAt = Date.now();
        if (idx === -1) this.environments.push(env);
        else this.environments[idx] = env;
        await this.save();
    }

    async deleteEnvironment(id: string): Promise<void> {
        this.environments = this.environments.filter((e) => e.id !== id);
        await this.save();
    }

    async upsertVar(envId: string, variable: EnvVariable): Promise<void> {
        const env = this.environments.find((e) => e.id === envId);
        if (!env) return;
        const idx = env.variables.findIndex((x) => x.id === variable.id);
        if (idx === -1) env.variables.push(variable);
        else env.variables[idx] = variable;
        env.updatedAt = Date.now();
        await this.save();
    }

    async deleteVar(envId: string, varId: string): Promise<void> {
        const env = this.environments.find((e) => e.id === envId);
        if (!env) return;
        env.variables = env.variables.filter((x) => x.id !== varId);
        env.updatedAt = Date.now();
        await this.save();
    }

    /** Values only, for process-level output redaction. Never exposed as a status payload. */
    secretValues(): string[] {
        return this.environments.flatMap((environment) =>
            environment.variables.map((variable) => variable.value).filter((value) => typeof value === "string" && value.length > 0),
        );
    }

    /** Clear values while preserving environment structure, names, categories, and tags. */
    async clearSecrets(): Promise<number> {
        let cleared = 0;
        const now = Date.now();
        for (const environment of this.environments) {
            let changed = false;
            for (const variable of environment.variables) {
                if (variable.value) {
                    variable.value = "";
                    cleared += 1;
                    changed = true;
                }
            }
            if (changed) environment.updatedAt = now;
        }
        await this.save();
        return cleared;
    }

    /** Parse a .env file's KEY=VALUE lines and merge into an environment. */
    async importEnv(envId: string, content: string): Promise<void> {
        const env = this.environments.find((e) => e.id === envId);
        if (!env) return;
        for (const rawLine of content.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            const eq = line.indexOf("=");
            if (eq === -1) continue;
            const name = line.slice(0, eq).trim().replace(/^export\s+/, "");
            let value = line.slice(eq + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (!name) continue;
            const existing = env.variables.find((x) => x.name === name);
            if (existing) existing.value = value;
            else env.variables.push({ id: genId("var"), name, value, category: "custom", tags: [] });
        }
        env.updatedAt = Date.now();
        await this.save();
    }

    private async save(): Promise<void> {
        await writeProtectedJson(this.file, { environments: this.environments });
    }
}
