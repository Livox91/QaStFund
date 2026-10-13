import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const acceptedUnfixedAdvisories = new Map([
  [
    1145093,
    {
      packageName: "deepmerge-ts",
      version: "7.1.5",
      advisory: "GHSA-ggr8-5vv4-36mx",
      reason:
        "Prisma 7.10.0 pins deepmerge-ts 7; upstream has no compatible release.",
    },
  ],
  [
    1240992,
    {
      packageName: "braces",
      version: "3.0.3",
      advisory: "GHSA-vfj7-8cjw-p6xm",
      reason:
        "No patched braces release exists; npm proposes an incompatible Next downgrade.",
    },
  ],
]);

function advisoryObjects(report) {
  return Object.values(report.vulnerabilities ?? {}).flatMap((vulnerability) =>
    (vulnerability.via ?? []).filter((item) => typeof item === "object"),
  );
}

export function evaluateAuditReport(report, lockfile) {
  const problems = [];
  const serious = Object.values(report.vulnerabilities ?? {}).filter((item) =>
    ["high", "critical"].includes(item.severity),
  );
  const advisories = advisoryObjects(report);
  const seenSources = new Set(advisories.map((item) => item.source));

  for (const advisory of advisories) {
    const accepted = acceptedUnfixedAdvisories.get(advisory.source);
    if (!accepted) {
      problems.push(
        `Unapproved ${advisory.severity} advisory ${advisory.url ?? advisory.source} affects ${advisory.name}.`,
      );
      continue;
    }
    if (advisory.name !== accepted.packageName) {
      problems.push(
        `Advisory ${advisory.source} unexpectedly affects ${advisory.name}.`,
      );
    }
    const installed =
      lockfile.packages?.[`node_modules/${accepted.packageName}`];
    if (installed?.version !== accepted.version) {
      problems.push(
        `${accepted.packageName} changed from reviewed version ${accepted.version} to ${installed?.version ?? "missing"}; re-review ${accepted.advisory}.`,
      );
    }
  }

  if (serious.length > 0 && seenSources.size === 0) {
    problems.push(
      "High/critical dependency findings did not expose advisory identifiers.",
    );
  }
  for (const source of acceptedUnfixedAdvisories.keys()) {
    if (!seenSources.has(source)) continue;
    const accepted = acceptedUnfixedAdvisories.get(source);
    if (!advisories.some((item) => item.name === accepted.packageName)) {
      problems.push(
        `Accepted advisory ${source} was not attached to its reviewed package.`,
      );
    }
  }

  return { problems, serious, advisories };
}

async function runAudit() {
  let stdout;
  try {
    const command = process.platform === "win32" ? process.env.ComSpec : "npm";
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npm audit --json"]
        : ["audit", "--json"];
    ({ stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    stdout = error.stdout;
    if (!stdout) throw error;
  }
  const report = JSON.parse(stdout);
  const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
  const result = evaluateAuditReport(report, lockfile);
  if (result.problems.length > 0) {
    throw new Error(
      `Dependency audit policy failed:\n${result.problems.join("\n")}`,
    );
  }
  const accepted = [...new Set(result.advisories.map((item) => item.source))];
  process.stdout.write(
    `Dependency audit policy passed: ${result.serious.length} high/critical dependency nodes map only to ${accepted.length} reviewed, currently unfixable advisories.\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runAudit();
}
