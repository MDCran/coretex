import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function sarifFiles(inputPath) {
  const absolute = resolve(inputPath);
  const metadata = await stat(absolute);
  if (metadata.isFile()) return [absolute];
  if (!metadata.isDirectory())
    throw new Error(`CodeQL output is not a file or directory: ${absolute}`);

  const files = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...(await sarifFiles(child)));
    else if (
      entry.isFile() &&
      [".sarif", ".json"].includes(extname(entry.name).toLowerCase())
    )
      files.push(child);
  }
  return files;
}

function ruleLevel(run, result) {
  if (result.level) return result.level;
  const rule = run.tool?.driver?.rules?.find(
    (candidate) => candidate.id === result.ruleId,
  );
  return rule?.defaultConfiguration?.level ?? "warning";
}

export function summarizeSarif(document) {
  const findings = [];
  for (const run of document.runs ?? []) {
    for (const result of run.results ?? []) {
      const location = result.locations?.[0]?.physicalLocation;
      const artifact = location?.artifactLocation?.uri ?? "unknown file";
      const line = location?.region?.startLine;
      findings.push({
        ruleId: result.ruleId ?? "unknown-rule",
        level: ruleLevel(run, result),
        location: line ? `${artifact}:${line}` : artifact,
      });
    }
  }
  return findings;
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error("Pass the CodeQL SARIF output path.");

  const files = await sarifFiles(outputPath);
  if (files.length === 0)
    throw new Error(
      `No SARIF files were produced under ${resolve(outputPath)}.`,
    );

  const findings = [];
  for (const file of files) {
    const document = JSON.parse(await readFile(file, "utf8"));
    findings.push(...summarizeSarif(document));
  }

  if (findings.length === 0) {
    console.log(
      `CodeQL produced zero findings across ${files.length} SARIF file(s).`,
    );
    return;
  }

  console.error(`CodeQL produced ${findings.length} finding(s):`);
  for (const finding of findings.slice(0, 50)) {
    console.error(
      `- [${finding.level}] ${finding.ruleId} at ${finding.location}`,
    );
  }
  if (findings.length > 50)
    console.error(`- ...and ${findings.length - 50} more`);
  process.exitCode = 1;
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
