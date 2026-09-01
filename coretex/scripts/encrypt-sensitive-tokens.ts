import { prisma } from "../src/db/prisma.js";
import { migrateLifeOSIntegrationSecrets } from "../src/lifeos/credential-migration.js";
import { assertIntegrationSecretKey } from "../src/security/integration-secret-box.js";

async function main(): Promise<void> {
    assertIntegrationSecretKey();
    const updated = await migrateLifeOSIntegrationSecrets();
    process.stdout.write(`Encrypted credential rows: ${updated}\n`);
}

main()
    .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : "Credential migration failed"}\n`);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
