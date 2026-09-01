/**
 * Import the NEEDS_HANDLING folder into a LifeOS user account.
 *
 * Usage:
 *   $env:NODE_OPTIONS="--conditions=react-server"
 *   npx tsx scripts/import-needs-handling.ts --user-email user@example.test --process-statements
 *
 * The react-server condition is only required when --process-statements is used,
 * because the statement extractor imports server-only app modules.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient, type FinAccountKind, type JobDocumentKind } from "@prisma/client";

interface Args {
    userEmail: string;
    root: string;
    dryRun: boolean;
    processStatements: boolean;
    statementLimit: number | null;
}

interface Counters {
    filesSeen: number;
    filesUploaded: number;
    existingSkipped: number;
    duplicateSkipped: number;
    institutionsCreated: number;
    accountsCreated: number;
    cardsCreated: number;
    cardNumbersCreated: number;
    statementsCreated: number;
    statementsQueued: number;
    statementsProcessed: number;
    statementsFailed: number;
    financialDocsCreated: number;
    medicalProvidersCreated: number;
    medicalRecordsCreated: number;
    careerDocumentsCreated: number;
    careerVersionsCreated: number;
    careerCertificationsCreated: number;
    creditScoresCreated: number;
}

type StatementResult = Awaited<ReturnType<StatementProcessor>>;
type StatementProcessor = (statementId: string, userId: string) => Promise<{
    status: "DONE" | "FAILED";
    inserted: number;
    skipped: number;
    duplicate?: boolean;
    error?: string;
}>;

const DEFAULT_DB_URL = "postgresql://lifeos:lifeos@localhost:5450/lifeos?schema=public";
const DEFAULT_S3_ENDPOINT = "http://localhost:9400";
const DEFAULT_S3_BUCKET = "lifeos";
const DEFAULT_REGION = "us-east-1";

const counts: Counters = {
    filesSeen: 0,
    filesUploaded: 0,
    existingSkipped: 0,
    duplicateSkipped: 0,
    institutionsCreated: 0,
    accountsCreated: 0,
    cardsCreated: 0,
    cardNumbersCreated: 0,
    statementsCreated: 0,
    statementsQueued: 0,
    statementsProcessed: 0,
    statementsFailed: 0,
    financialDocsCreated: 0,
    medicalProvidersCreated: 0,
    medicalRecordsCreated: 0,
    careerDocumentsCreated: 0,
    careerVersionsCreated: 0,
    careerCertificationsCreated: 0,
    creditScoresCreated: 0,
};

loadEnv();

const args = parseArgs();
const root = path.resolve(args.root);
const db = new PrismaClient({
    datasources: { db: { url: process.env.LIFEOS_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DB_URL } },
});

const s3 = new S3Client({
    endpoint: process.env.LIFEOS_S3_ENDPOINT ?? process.env.S3_ENDPOINT ?? DEFAULT_S3_ENDPOINT,
    region: process.env.LIFEOS_S3_REGION ?? DEFAULT_REGION,
    forcePathStyle: true,
    credentials: {
        accessKeyId: process.env.LIFEOS_S3_ACCESS_KEY ?? process.env.S3_ACCESS_KEY ?? "minioadmin",
        secretAccessKey: process.env.LIFEOS_S3_SECRET_KEY ?? process.env.S3_SECRET_KEY ?? "minioadmin",
    },
});
const bucket = process.env.LIFEOS_S3_BUCKET ?? process.env.S3_BUCKET ?? DEFAULT_S3_BUCKET;

const statementIdsToProcess: string[] = [];
const cardScans = new Map<string, CardScan>();
const healthDuplicateKeys = new Set<string>();

function loadEnv(): void {
    const envPath = path.join(process.cwd(), ".env");
    if (!existsSync(envPath)) return;
    for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] ??= value;
    }
}

function parseArgs(argv = process.argv.slice(2)): Args {
    const parsed: Args = {
        userEmail: "",
        root: "NEEDS_HANDLING",
        dryRun: false,
        processStatements: false,
        statementLimit: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--user-email") parsed.userEmail = argv[++i] ?? "";
        else if (arg.startsWith("--user-email=")) parsed.userEmail = arg.slice("--user-email=".length);
        else if (arg === "--root") parsed.root = argv[++i] ?? parsed.root;
        else if (arg.startsWith("--root=")) parsed.root = arg.slice("--root=".length);
        else if (arg === "--dry-run") parsed.dryRun = true;
        else if (arg === "--process-statements") parsed.processStatements = true;
        else if (arg === "--statement-limit") parsed.statementLimit = Number(argv[++i] ?? "0") || null;
        else if (arg.startsWith("--statement-limit=")) parsed.statementLimit = Number(arg.slice("--statement-limit=".length)) || null;
    }
    if (!parsed.userEmail) throw new Error("Missing --user-email <email>");
    return parsed;
}

async function walkFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walkFiles(full)));
        else if (entry.isFile()) files.push(full);
    }
    return files;
}

function relPath(file: string): string {
    return path.relative(root, file).split(path.sep).join("/");
}

function extLower(file: string): string {
    return path.extname(file).toLowerCase();
}

function isPdf(file: string): boolean {
    return extLower(file) === ".pdf";
}

function mimeType(file: string): string {
    const ext = extLower(file);
    const types: Record<string, string> = {
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".ppt": "application/vnd.ms-powerpoint",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".csv": "text/csv",
        ".tsv": "text/tab-separated-values",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".json": "application/json",
        ".xml": "application/xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".mp4": "video/mp4",
        ".zip": "application/zip",
        ".lnk": "application/octet-stream",
    };
    return types[ext] ?? "application/octet-stream";
}

function safeSegment(s: string): string {
    return s.replace(/[^a-zA-Z0-9._@-]/g, "_").replace(/_+/g, "_").slice(0, 140) || "file";
}

function keyFor(userId: string, module: string, rel: string): string {
    const hash = createHash("sha256").update(rel.toLowerCase()).digest("hex").slice(0, 12);
    const base = safeSegment(path.basename(rel));
    return `u/${userId}/${module}/needs-handling/${hash}-${base}`;
}

async function uploadLocalFile(userId: string, module: string, file: string, rel: string): Promise<string> {
    const key = keyFor(userId, module, rel);
    if (args.dryRun) return key;
    const st = statSync(file);
    await s3.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: st.size === 0 ? Buffer.alloc(0) : createReadStream(file),
            ContentType: mimeType(file),
            ContentLength: st.size,
        }),
    );
    counts.filesUploaded++;
    return key;
}

function titleize(input: string): string {
    return input
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanFolderName(folder: string): string {
    return titleize(folder.replace(/_(CLOSED|REPLACED)$/i, ""));
}

function last4FromName(name: string): string | null {
    return name.match(/(\d{4})(?:_(?:CLOSED|REPLACED))?$/i)?.[1] ?? null;
}

function institutionNameFrom(input: string): string {
    const s = input.toLowerCase();
    if (s.includes("bank_of_america") || s.includes("bank of america")) return "Bank of America";
    if (s.includes("wells_fargo") || s.includes("wells fargo")) return "Wells Fargo";
    if (s.includes("fifth_third") || s.includes("fifth third")) return "Fifth Third Bank";
    if (s.includes("everbank")) return "EverBank";
    if (s.includes("citi")) return "Citibank";
    if (s.includes("alpaca")) return "Alpaca";
    if (s.includes("fidelity")) return "Fidelity Investments";
    if (s.includes("coinbase")) return "Coinbase";
    if (s.includes("american_express") || s.includes("american express")) return "American Express";
    if (s.includes("florida_prepaid") || s.includes("florida prepaid")) return "Florida Prepaid College Program";
    return cleanFolderName(input).replace(/\s+\d{4}$/, "");
}

async function ensureInstitution(userId: string, name: string): Promise<string | null> {
    if (args.dryRun) return null;
    const existing = await db.institution.findUnique({ where: { userId_name: { userId, name } }, select: { id: true } });
    if (existing) return existing.id;
    const created = await db.institution.create({ data: { userId, name } });
    counts.institutionsCreated++;
    return created.id;
}

function accountKindFrom(category: string): FinAccountKind {
    if (category.includes("Checking")) return "CHECKING";
    if (category.includes("Savings")) return "SAVINGS";
    if (category.includes("Brokerage") || category.includes("Retirement")) return "BROKERAGE";
    return "OTHER";
}

async function ensureFinAccount(userId: string, rel: string): Promise<string | null> {
    const parts = rel.split("/");
    if (parts[0] !== "Assets" || parts[1] !== "Accounts" || !parts[2] || !parts[3]) return null;

    const category = parts[2];
    const folder = parts[3];
    const kind = accountKindFrom(category);
    const last4 = last4FromName(folder);
    const nickname = cleanFolderName(folder);
    const archived = /_(CLOSED|REPLACED)$/i.test(folder);
    const institutionId = await ensureInstitution(userId, institutionNameFrom(folder));
    if (args.dryRun) {
        counts.accountsCreated++;
        return null;
    }

    const existing = await db.finAccount.findFirst({
        where: { userId, kind, nickname, last4 },
        select: { id: true, archived: true },
    });
    if (existing) {
        if (existing.archived !== archived) await db.finAccount.update({ where: { id: existing.id }, data: { archived } });
        return existing.id;
    }

    const created = await db.finAccount.create({
        data: {
            userId,
            kind,
            institutionId,
            nickname,
            last4,
            currentBalance: 0,
            archived,
            includeInNetWorth: !archived,
            isAsset: kind !== "LOAN",
            notes: `Imported from NEEDS_HANDLING/${parts.slice(0, 4).join("/")}`,
        },
    });
    counts.accountsCreated++;
    return created.id;
}

interface CardNumberScan {
    folder: string;
    last4: string;
    validFrom: Date | null;
    validTo: Date | null;
    isCurrent: boolean;
}

interface CardScan {
    productFolder: string;
    productName: string;
    institutionName: string;
    currentLast4: string | null;
    numbers: CardNumberScan[];
}

async function scanCreditCards(): Promise<void> {
    const cardsRoot = path.join(root, "Credit", "Credit_Cards");
    if (!existsSync(cardsRoot)) return;
    const productEntries = await readdir(cardsRoot, { withFileTypes: true });
    for (const productEntry of productEntries.filter((e) => e.isDirectory())) {
        const productFolder = productEntry.name;
        const productDir = path.join(cardsRoot, productFolder);
        const childEntries = await readdir(productDir, { withFileTypes: true });
        const rawNumbers: Array<Omit<CardNumberScan, "isCurrent">> = [];
        for (const child of childEntries.filter((e) => e.isDirectory())) {
            const last4 = last4FromName(child.name);
            if (!last4) continue;
            const statementFiles = (await walkFiles(path.join(productDir, child.name))).filter((f) => isPdf(f) && path.basename(f).toLowerCase().startsWith("statement_"));
            const periods = statementFiles.map((f) => parseStatementPeriod(path.basename(f))).filter((p): p is { start: Date; end: Date } => Boolean(p));
            rawNumbers.push({
                folder: child.name,
                last4,
                validFrom: minDate(periods.map((p) => p.start)),
                validTo: maxDate(periods.map((p) => p.end)),
            });
        }
        const current = [...rawNumbers].sort((a, b) => (b.validTo?.getTime() ?? 0) - (a.validTo?.getTime() ?? 0))[0]?.last4 ?? null;
        cardScans.set(productFolder, {
            productFolder,
            productName: cleanFolderName(productFolder),
            institutionName: institutionNameFrom(productFolder),
            currentLast4: current,
            numbers: rawNumbers.map((n) => ({ ...n, isCurrent: n.last4 === current })),
        });
    }
}

async function ensureCreditCard(userId: string, productFolder: string): Promise<string | null> {
    const scan = cardScans.get(productFolder) ?? {
        productFolder,
        productName: cleanFolderName(productFolder),
        institutionName: institutionNameFrom(productFolder),
        currentLast4: null,
        numbers: [],
    };
    const institutionId = await ensureInstitution(userId, scan.institutionName);
    if (args.dryRun) {
        counts.cardsCreated++;
        counts.cardNumbersCreated += scan.numbers.length;
        return null;
    }

    let card = await db.creditCard.findFirst({
        where: { userId, productName: scan.productName },
        select: { id: true, last4: true },
    });
    if (!card) {
        card = await db.creditCard.create({
            data: {
                userId,
                institutionId,
                nickname: scan.productName,
                productName: scan.productName,
                last4: scan.currentLast4,
                cardType: "CREDIT",
                currentBalance: 0,
                notes: `Imported from NEEDS_HANDLING/Credit/Credit_Cards/${productFolder}`,
            },
            select: { id: true, last4: true },
        });
        counts.cardsCreated++;
    } else if (scan.currentLast4 && card.last4 !== scan.currentLast4) {
        await db.creditCard.update({ where: { id: card.id }, data: { last4: scan.currentLast4, institutionId } });
    }

    for (const number of scan.numbers) {
        const existing = await db.cardNumber.findFirst({ where: { creditCardId: card.id, last4: number.last4 }, select: { id: true } });
        if (existing) {
            await db.cardNumber.update({
                where: { id: existing.id },
                data: { validFrom: number.validFrom, validTo: number.validTo, isCurrent: number.isCurrent, notes: `Folder: ${number.folder}` },
            });
        } else {
            await db.cardNumber.create({
                data: {
                    creditCardId: card.id,
                    last4: number.last4,
                    validFrom: number.validFrom,
                    validTo: number.validTo,
                    isCurrent: number.isCurrent,
                    notes: `Folder: ${number.folder}`,
                },
            });
            counts.cardNumbersCreated++;
        }
    }
    return card.id;
}

async function ensureCreditCardForRel(userId: string, rel: string): Promise<string | null> {
    const parts = rel.split("/");
    if (parts[0] !== "Credit" || parts[1] !== "Credit_Cards" || !parts[2]) return null;
    return ensureCreditCard(userId, parts[2]);
}

function parseStatementPeriod(fileName: string): { start: Date; end: Date } | null {
    const match = fileName.match(/Statement_(\d{1,2}-\d{1,2}-\d{4})_(\d{1,2}-\d{1,2}-\d{4})/i);
    if (!match) return null;
    const start = parseMonthDayYear(match[1]);
    const end = parseMonthDayYear(match[2]);
    return start && end ? { start, end } : null;
}

function parseMonthDayYear(value: string): Date | null {
    const [m, d, y] = value.split("-").map(Number);
    if (!m || !d || !y) return null;
    return new Date(Date.UTC(y, m - 1, d));
}

function parseSlashDate(value: string): Date | null {
    const [m, d, y] = value.split("/").map(Number);
    if (!m || !d || !y) return null;
    return new Date(Date.UTC(y, m - 1, d));
}

function minDate(values: Array<Date | null>): Date | null {
    const times = values.filter((v): v is Date => Boolean(v)).map((v) => v.getTime());
    return times.length ? new Date(Math.min(...times)) : null;
}

function maxDate(values: Array<Date | null>): Date | null {
    const times = values.filter((v): v is Date => Boolean(v)).map((v) => v.getTime());
    return times.length ? new Date(Math.max(...times)) : null;
}

function isStatementFile(rel: string): boolean {
    const lower = rel.toLowerCase();
    const base = path.basename(rel).toLowerCase();
    return isPdf(rel) && base.startsWith("statement_") && (lower.startsWith("assets/accounts/") || lower.startsWith("credit/credit_cards/"));
}

async function importStatement(userId: string, file: string, rel: string): Promise<void> {
    const key = keyFor(userId, "financial", rel);
    const existing = await db.finStatement.findFirst({ where: { userId, fileKey: key }, select: { id: true, processingStatus: true } });
    if (existing) {
        counts.existingSkipped++;
        maybeQueueStatement(existing.id, existing.processingStatus);
        return;
    }
    const period = parseStatementPeriod(path.basename(file));
    const finAccountId = rel.startsWith("Assets/Accounts/") ? await ensureFinAccount(userId, rel) : null;
    const creditCardId = rel.startsWith("Credit/Credit_Cards/") ? await ensureCreditCardForRel(userId, rel) : null;
    const st = statSync(file);
    if (args.dryRun) {
        counts.statementsCreated++;
        return;
    }
    const fileKey = await uploadLocalFile(userId, "financial", file, rel);
    const created = await db.finStatement.create({
        data: {
            userId,
            finAccountId,
            creditCardId,
            fileKey,
            fileName: path.basename(file),
            mimeType: mimeType(file),
            fileSize: st.size,
            periodStart: period?.start ?? null,
            periodEnd: period?.end ?? null,
            processingStatus: "PENDING",
        },
    });
    counts.statementsCreated++;
    maybeQueueStatement(created.id, created.processingStatus);
}

function maybeQueueStatement(id: string, status: "PENDING" | "PROCESSING" | "DONE" | "FAILED"): void {
    if (!args.processStatements || status === "DONE") return;
    if (args.statementLimit !== null && statementIdsToProcess.length >= args.statementLimit) return;
    statementIdsToProcess.push(id);
    counts.statementsQueued++;
}

function inferYear(rel: string): number {
    const years = [...rel.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
    return years[0] ?? new Date().getFullYear();
}

function financialDocKind(rel: string): string {
    const lower = rel.toLowerCase();
    if (lower.startsWith("taxes_&_legal/irs/")) return "tax";
    if (lower.includes("/legal") || lower.startsWith("taxes_&_legal/legal")) return "legal";
    if (lower.startsWith("cashflow/")) return "cashflow";
    if (lower.startsWith("credit/credit_reports/")) return "credit-report";
    if (lower.startsWith("credit/credit_cards/")) return "credit-card-document";
    if (lower.startsWith("credit/")) return "credit";
    if (lower.startsWith("assets/accounts/")) return "account-document";
    if (lower.startsWith("assets/")) return "asset-document";
    if (lower.includes("social_security")) return "social-security";
    if (lower.startsWith("michael_david_cran/identification/")) return "identification";
    if (lower.startsWith("michael_david_cran/insurance/")) return "insurance";
    if (lower.startsWith("michael_david_cran/privacy_reports/")) return "privacy-report";
    if (lower.startsWith("michael_david_cran/residency/")) return "residency";
    if (lower.startsWith("michael_david_cran/signature/")) return "signature";
    if (lower.startsWith("michael_david_cran/vehicle/")) return "vehicle";
    return "financial-document";
}

async function importFinancialDoc(userId: string, file: string, rel: string): Promise<void> {
    if (rel.startsWith("Assets/Accounts/")) await ensureFinAccount(userId, rel);
    if (rel.startsWith("Credit/Credit_Cards/")) await ensureCreditCardForRel(userId, rel);

    const key = keyFor(userId, "financial", rel);
    const existing = await db.taxDocument.findFirst({ where: { userId, fileKey: key }, select: { id: true } });
    if (existing) {
        counts.existingSkipped++;
        return;
    }
    if (args.dryRun) {
        counts.financialDocsCreated++;
        return;
    }
    const fileKey = await uploadLocalFile(userId, "financial", file, rel);
    await db.taxDocument.create({
        data: {
            userId,
            taxYear: inferYear(rel),
            kind: financialDocKind(rel),
            description: titleize(path.basename(file)),
            fileKey,
            fileName: path.basename(file),
            notes: `Imported from NEEDS_HANDLING/${rel}`,
        },
    });
    counts.financialDocsCreated++;

    if (rel === "Credit/Credit_Score_History.md") {
        await importCreditScoreHistory(userId, file);
    }
}

async function importCreditScoreHistory(userId: string, file: string): Promise<void> {
    const text = readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\|\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
        if (!match) continue;
        const scoreDate = parseSlashDate(match[1]);
        if (!scoreDate) continue;
        const cells: Array<["EQUIFAX" | "EXPERIAN" | "TRANSUNION", string]> = [
            ["EQUIFAX", match[2]],
            ["EXPERIAN", match[3]],
            ["TRANSUNION", match[4]],
        ];
        for (const [bureau, cell] of cells) {
            const score = Number(cell.match(/\b(\d{3})\b/)?.[1] ?? "");
            if (!score) continue;
            const existing = await db.creditScoreEntry.findFirst({ where: { userId, bureau, scoreDate }, select: { id: true } });
            if (existing) continue;
            await db.creditScoreEntry.create({ data: { userId, bureau, score, scoreDate, notes: "Imported from NEEDS_HANDLING/Credit/Credit_Score_History.md" } });
            counts.creditScoresCreated++;
        }
    }
}

function inferProviderName(rel: string): string | null {
    const parts = rel.split("/");
    if (parts[0] === "Health" && parts[1] === "Doctor_Files") return cleanFolderName(parts[2] ?? "Provider");
    if (parts[0] === "Health" && parts[1] === "Health_Log") return "Health Log";
    if (parts[0] === "Michael_David_Cran" && parts[1] === "Health" && parts[2] === "Doctor_Files") return cleanFolderName(parts[3] ?? "Provider");
    if (parts[0] === "Michael_David_Cran" && parts[1] === "Health" && parts[2] === "Lab_Results") return cleanFolderName(parts[3] ?? "Lab Results");
    if (parts[0] === "Michael_David_Cran" && parts[1] === "Health" && parts[2] === "Immunization_Records") return "Immunization Records";
    return null;
}

function inferRecordDate(rel: string): Date | null {
    const ymd = rel.match(/\b(20\d{2})[-_](\d{2})[-_](\d{2})\b/);
    if (ymd) return new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    const mdy = rel.match(/\b(\d{2})-(\d{2})-(20\d{2})\b/);
    if (mdy) return new Date(Date.UTC(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2])));
    return null;
}

async function ensureMedicalProvider(userId: string, name: string): Promise<string | null> {
    if (args.dryRun) return null;
    const existing = await db.provider.findFirst({ where: { userId, name }, select: { id: true } });
    if (existing) return existing.id;
    const created = await db.provider.create({ data: { userId, name, notes: "Imported from NEEDS_HANDLING" } });
    counts.medicalProvidersCreated++;
    return created.id;
}

async function importMedicalRecord(userId: string, file: string, rel: string): Promise<void> {
    const st = statSync(file);
    const duplicateKey = `${path.basename(file).toLowerCase()}|${st.size}`;
    if (healthDuplicateKeys.has(duplicateKey)) {
        counts.duplicateSkipped++;
        return;
    }
    healthDuplicateKeys.add(duplicateKey);

    const dbDuplicate = await db.medicalRecord.findFirst({ where: { userId, fileName: path.basename(file), fileSize: st.size }, select: { id: true } });
    if (dbDuplicate) {
        counts.existingSkipped++;
        return;
    }

    const providerName = inferProviderName(rel);
    const providerId = providerName ? await ensureMedicalProvider(userId, providerName) : null;
    if (args.dryRun) {
        counts.medicalRecordsCreated++;
        return;
    }
    const fileKey = await uploadLocalFile(userId, "health", file, rel);
    await db.medicalRecord.create({
        data: {
            userId,
            name: titleize(path.basename(file)),
            providerId,
            providerName,
            recordDate: inferRecordDate(rel),
            fileKey,
            fileName: path.basename(file),
            mimeType: mimeType(file),
            fileSize: st.size,
            notes: `Imported from NEEDS_HANDLING/${rel}`,
        },
    });
    counts.medicalRecordsCreated++;
}

function careerKind(rel: string): JobDocumentKind {
    const lower = rel.toLowerCase();
    if (lower.includes("/cover_letter") || lower.includes("cover letter")) return "COVER_LETTER";
    if (lower.startsWith("career/documents/resumes/") || lower.includes("-resume") || lower.includes("_resume")) return "RESUME";
    if (lower.startsWith("career/certifications/") || lower.includes("certification") || lower.includes("certificate")) return "CERTIFICATION";
    if (lower.startsWith("career/education/")) return "EDUCATION";
    return "CAREER_OTHER";
}

function careerDocName(rel: string, kind: JobDocumentKind): string {
    if (kind === "RESUME" && rel.startsWith("Career/Documents/Resumes/")) return "Michael Cran Resume";
    const parts = rel.split("/");
    if (kind === "EDUCATION") return parts.slice(1).join(" / ").replace(/\.[^.]+$/, "");
    return titleize(path.basename(rel));
}

async function ensureJobDocument(userId: string, name: string, kind: JobDocumentKind): Promise<string | null> {
    if (args.dryRun) return null;
    const existing = await db.jobDocument.findFirst({ where: { userId, name, kind }, select: { id: true } });
    if (existing) return existing.id;
    const created = await db.jobDocument.create({ data: { userId, name, kind } });
    counts.careerDocumentsCreated++;
    return created.id;
}

async function importCareerFile(userId: string, file: string, rel: string): Promise<void> {
    const key = keyFor(userId, "jobs", rel);
    const existing = await db.jobDocumentVersion.findFirst({ where: { fileKey: key, document: { userId } }, select: { id: true } });
    if (existing) {
        counts.existingSkipped++;
        return;
    }

    const kind = careerKind(rel);
    const docName = careerDocName(rel, kind);
    if (kind === "CERTIFICATION") await ensureCareerCertification(userId, rel);
    if (args.dryRun) {
        counts.careerDocumentsCreated++;
        counts.careerVersionsCreated++;
        return;
    }
    const documentId = await ensureJobDocument(userId, docName, kind);
    if (!documentId) return;
    const last = await db.jobDocumentVersion.findFirst({ where: { documentId }, orderBy: { versionNumber: "desc" }, select: { versionNumber: true } });
    const fileKey = await uploadLocalFile(userId, "jobs", file, rel);
    const st = statSync(file);
    await db.jobDocumentVersion.create({
        data: {
            documentId,
            versionNumber: (last?.versionNumber ?? 0) + 1,
            label: `NEEDS_HANDLING/${rel}`,
            fileKey,
            fileName: path.basename(file),
            fileSize: st.size,
            mimeType: mimeType(file),
        },
    });
    counts.careerVersionsCreated++;
}

async function ensureCareerCertification(userId: string, rel: string): Promise<void> {
    if (args.dryRun) {
        counts.careerCertificationsCreated++;
        return;
    }
    const name = titleize(path.basename(rel));
    const existing = await db.careerCertification.findFirst({ where: { userId, name }, select: { id: true } });
    if (existing) return;
    await db.careerCertification.create({
        data: {
            userId,
            name,
            issuer: certificationIssuer(name),
            status: "completed",
        },
    });
    counts.careerCertificationsCreated++;
}

function certificationIssuer(name: string): string | null {
    const lower = name.toLowerCase();
    if (lower.includes("autodesk")) return "Autodesk";
    if (lower.includes("faa")) return "Federal Aviation Administration";
    if (lower.includes("drone")) return "Drone Trust";
    if (lower.includes("testout")) return "TestOut";
    return null;
}

function shouldImportAsHealth(rel: string): boolean {
    return rel.startsWith("Health/") || rel.startsWith("Michael_David_Cran/Health/");
}

function shouldImportAsCareer(rel: string): boolean {
    return rel.startsWith("Career/");
}

function shouldImportAsFinancial(rel: string): boolean {
    return (
        rel.startsWith("Assets/") ||
        rel.startsWith("Credit/") ||
        rel.startsWith("Cashflow/") ||
        rel.startsWith("Taxes_&_Legal/") ||
        rel.startsWith("Michael_David_Cran/")
    );
}

async function routeFile(userId: string, file: string): Promise<void> {
    const rel = relPath(file);
    counts.filesSeen++;

    if (isStatementFile(rel)) {
        await importStatement(userId, file, rel);
        return;
    }
    if (shouldImportAsHealth(rel)) {
        await importMedicalRecord(userId, file, rel);
        return;
    }
    if (shouldImportAsCareer(rel)) {
        await importCareerFile(userId, file, rel);
        return;
    }
    if (shouldImportAsFinancial(rel)) {
        await importFinancialDoc(userId, file, rel);
    }
}

async function processQueuedStatements(userId: string): Promise<void> {
    if (!args.processStatements || args.dryRun || statementIdsToProcess.length === 0) return;
    console.log(`\nProcessing ${statementIdsToProcess.length} statement PDF(s) with the app extractor...`);
    let processStatement: StatementProcessor;
    try {
        ({ processStatement } = (await import("../src/lib/financial/statement-extract")) as { processStatement: StatementProcessor });
    } catch (error) {
        throw new Error(`Could not load statement extractor. Run with NODE_OPTIONS=--conditions=react-server. ${(error as Error).message}`);
    }

    for (let i = 0; i < statementIdsToProcess.length; i++) {
        const id = statementIdsToProcess[i];
        process.stdout.write(`  [${i + 1}/${statementIdsToProcess.length}] ${id} ... `);
        try {
            const result: StatementResult = await processStatement(id, userId);
            counts.statementsProcessed++;
            process.stdout.write(`${result.status}, inserted ${result.inserted}, skipped ${result.skipped}\n`);
        } catch (error) {
            counts.statementsFailed++;
            process.stdout.write(`FAILED: ${(error as Error).message}\n`);
        }
    }
}

async function main(): Promise<void> {
    if (!existsSync(root)) throw new Error(`Root not found: ${root}`);
    await scanCreditCards();

    const user = await db.user.findUnique({ where: { email: args.userEmail.toLowerCase() }, select: { id: true, email: true } });
    if (!user) throw new Error(`No LifeOS user found for ${args.userEmail}`);

    console.log(`Importing ${root} into ${user.email}${args.dryRun ? " (dry run)" : ""}`);
    const files = (await walkFiles(root)).sort((a, b) => relPath(a).localeCompare(relPath(b)));
    for (const file of files) {
        await routeFile(user.id, file);
        if (counts.filesSeen % 100 === 0) {
            console.log(`  routed ${counts.filesSeen}/${files.length} files...`);
        }
    }

    await processQueuedStatements(user.id);
    console.log("\nImport summary:");
    for (const [key, value] of Object.entries(counts)) {
        console.log(`  ${key.padEnd(30)} ${value}`);
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$disconnect();
    });
