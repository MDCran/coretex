/**
 * LifeOS data migration — runs all four source migrations in order.
 *
 * Usage:
 *   npx tsx scripts/migrate/migrate-all.ts --user-email you@example.com [--dry-run] [--force]
 *
 * Flags:
 *   --user-email <email>  REQUIRED. The target LifeOS account that will OWN all
 *                         migrated rows. The account must already exist (register
 *                         first) — the script looks it up and fails if missing.
 *   --dry-run             Print per-table row counts for each source without
 *                         writing anything to the target DB or S3.
 *   --force               Re-run even if a source's completion marker exists.
 *
 * Order (honors cross-source dependencies — none hard, but Jobs/Company are
 * seeded by apptracker first so workout/health career apps can reuse companies):
 *   1. apptracker  (Jobs)
 *   2. peptide     (Peptides)
 *   3. workout     (Workouts/Health/Financial/Social/Jobs/Calendar/Therapeutics)
 *   4. health      (Health/Social/Career/Learning/Financial/Focus/Calendar)
 *
 * Prereqs:
 *   - Source containers up and reachable (see scripts/migrate/README.md).
 *   - Target combined DB + MinIO up (lifeos@5450, MinIO@9400 bucket "lifeos").
 *
 * Idempotency: each source writes a SYSTEM Notification marker
 * "migration:<source> completed". Re-runs skip completed sources unless --force.
 * NOTE: --force does NOT delete previously-migrated rows; re-running with --force
 * will DUPLICATE non-upserted rows. Wipe the target user's data first if needed.
 */

import { migrateApptracker } from "./migrate-apptracker";
import { migrateHealth } from "./migrate-health";
import { migratePeptide } from "./migrate-peptide";
import { migrateWorkout } from "./migrate-workout";
import { parseArgs, prisma } from "./shared";

async function main(): Promise<void> {
    const args = parseArgs();
    console.log(
        `\n=== LifeOS migration ===\n  target user : ${args.userEmail}\n  dry-run     : ${args.dryRun}\n  force       : ${args.force}\n`,
    );

    const steps: Array<[string, () => Promise<void>]> = [
        ["apptracker", () => migrateApptracker(args)],
        ["peptide", () => migratePeptide(args)],
        ["workout", () => migrateWorkout(args)],
        ["health", () => migrateHealth(args)],
    ];

    const warnings: string[] = [];
    for (const [name, run] of steps) {
        console.log(`\n----- ${name} -----`);
        try {
            await run();
        } catch (err) {
            const msg = `[${name}] FAILED: ${(err as Error).message}`;
            console.error(msg);
            warnings.push(msg);
            // Continue with the remaining sources so a single unreachable DB
            // does not block the others.
        }
    }

    console.log("\n=== migration complete ===");
    if (warnings.length) {
        console.log("\nWarnings / failures:");
        for (const w of warnings) console.log(`  - ${w}`);
        process.exitCode = 1;
    }
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
