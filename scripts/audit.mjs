/**
 * CI dependency audit, run as `pnpm audit:ci` (plan §8; process in docs/06-SECURITY.md, "Dependency audit
 * exceptions"). Named `audit:ci` because a script called `audit` would be shadowed by pnpm's built-in command.
 *
 * Runs `pnpm audit --json` and fails when a high or critical advisory has no active exception in
 * scripts/audit-exceptions.json. Exceptions are keyed by GHSA id and expire: once the date has passed (UTC) the
 * advisory fails CI again. Also fails on audit output it can't read (for example a registry error), on a malformed
 * exceptions file, and on ignores configured in pnpm itself, which have no expiry. Exceptions that match no advisory
 * only print a warning, so they get deleted.
 *
 * Plain Node, no dependencies: CI runs it without installing node_modules.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const EXCEPTIONS = "scripts/audit-exceptions.json";

/** Advisories at these severities fail CI unless an active exception covers them. */
const GATED = new Set(["high", "critical"]);
const SEVERITY_RANK = new Map([
  ["info", 0],
  ["low", 1],
  ["moderate", 2],
  ["high", 3],
  ["critical", 4],
]);
const EXCEPTION_KEYS = ["ghsa", "package", "severity", "reason", "expires", "tracking"];
const MAX_EXPIRY_DAYS = 90;
const MIN_REASON_LENGTH = 40;

/** Everything that fails the run. Collected so one run reports all problems. */
const errors = [];

const log = (message) => {
  console.log(`audit: ${message}`);
};
const warn = (message) => {
  console.warn(`audit: warning: ${message}`);
};
const plural = (count, one, many = `${one}s`) => `${String(count)} ${count === 1 ? one : many}`;

/** Unknown severities rank above critical: they are gated and no exception can cover them (fail closed). */
const rankOf = (severity) => SEVERITY_RANK.get(severity) ?? Number.POSITIVE_INFINITY;
const isGated = (severity) => GATED.has(severity) || !SEVERITY_RANK.has(severity);

const todayUtc = () => new Date().toISOString().slice(0, 10);

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

/** A real calendar date written YYYY-MM-DD (rejects 2026-02-30). */
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Returns the problems with one exceptions-file entry; an empty list means it is well formed. */
function validateException(entry, latestExpiry) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return ["each entry must be an object"];
  const problems = Object.keys(entry)
    .filter((key) => !EXCEPTION_KEYS.includes(key))
    .map((key) => `unknown key "${key}"`);
  const missing = EXCEPTION_KEYS.filter((key) => typeof entry[key] !== "string" || entry[key].trim() === "");
  // The checks below read these fields as strings, so stop here if any is missing.
  if (missing.length > 0) return [...problems, ...missing.map((key) => `"${key}" must be a non-empty string`)];

  if (!/^GHSA(-[a-z0-9]{4}){3}$/.test(entry.ghsa)) problems.push(`"ghsa" must look like GHSA-xxxx-xxxx-xxxx`);
  if (!SEVERITY_RANK.has(entry.severity)) {
    problems.push(`"severity" must be one of ${[...SEVERITY_RANK.keys()].join(", ")}`);
  }
  if (entry.reason.trim().length < MIN_REASON_LENGTH) {
    problems.push(`"reason" must explain why the vulnerable code is unreachable here`);
  }
  if (!isCalendarDate(entry.expires)) {
    problems.push(`"expires" must be a real date written YYYY-MM-DD`);
  } else if (entry.expires > latestExpiry) {
    problems.push(
      `"expires" is more than ${String(MAX_EXPIRY_DAYS)} days away (latest allowed today: ${latestExpiry})`,
    );
  }
  return problems;
}

/** Reads and validates the exceptions file. Returns the well-formed entries by GHSA id, flagged when expired. */
function loadExceptions(today) {
  const byGhsa = new Map();
  let entries;
  try {
    entries = JSON.parse(readFileSync(new URL(EXCEPTIONS, ROOT), "utf8"));
  } catch (error) {
    errors.push(`${EXCEPTIONS} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
    return byGhsa;
  }
  if (!Array.isArray(entries)) {
    errors.push(`${EXCEPTIONS} must contain a JSON array`);
    return byGhsa;
  }
  const latestExpiry = addDays(today, MAX_EXPIRY_DAYS);
  entries.forEach((entry, index) => {
    const problems = validateException(entry, latestExpiry);
    if (problems.length > 0) {
      errors.push(`${EXCEPTIONS} entry ${String(index)} is malformed: ${problems.join("; ")}`);
    } else if (byGhsa.has(entry.ghsa)) {
      errors.push(`${EXCEPTIONS} entry ${String(index)} repeats ${entry.ghsa}`);
    } else {
      byGhsa.set(entry.ghsa, { ...entry, expired: entry.expires < today });
    }
  });
  return byGhsa;
}

/** pnpm's own ignore lists have no expiry, so they would bypass this script. */
function rejectUnmanagedIgnores() {
  const auditConfig = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")).pnpm?.auditConfig;
  if (auditConfig?.ignoreCves?.length > 0 || auditConfig?.ignoreGhsas?.length > 0) {
    errors.push(`package.json "pnpm.auditConfig" ignores advisories with no expiry; move them to ${EXCEPTIONS}`);
  }
  if (/^\s*auditConfig\s*:/m.test(readFileSync(new URL("pnpm-workspace.yaml", ROOT), "utf8"))) {
    errors.push(`pnpm-workspace.yaml sets "auditConfig"; record exceptions in ${EXCEPTIONS} instead`);
  }
}

/** Runs `pnpm audit --json`. Its exit code only means "something was found", so the JSON on stdout decides. */
function runAudit() {
  const result = spawnSync("pnpm", ["audit", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
    shell: process.platform === "win32",
  });
  if (result.error) {
    errors.push(`could not run pnpm audit: ${result.error.message}`);
    return undefined;
  }
  const exit = String(result.status ?? result.signal);
  const stdout = result.stdout.trim();
  if (stdout === "") {
    errors.push(`pnpm audit printed no output (exit ${exit}): ${result.stderr.trim().slice(-1000) || "no stderr"}`);
    return undefined;
  }
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    errors.push(`pnpm audit output is not JSON (exit ${exit}): ${stdout.slice(0, 500)}`);
    return undefined;
  }
  if (report?.error !== undefined) {
    errors.push(`pnpm audit failed (exit ${exit}): ${JSON.stringify(report.error).slice(0, 500)}`);
    return undefined;
  }
  if (
    typeof report?.advisories !== "object" ||
    report.advisories === null ||
    typeof report.metadata?.vulnerabilities !== "object"
  ) {
    errors.push(`pnpm audit output has no "advisories" or "metadata.vulnerabilities" (exit ${exit}); format changed?`);
    return undefined;
  }
  return report;
}

const ghsaOf = (advisory) =>
  typeof advisory.github_advisory_id === "string"
    ? advisory.github_advisory_id
    : /GHSA(-[a-z0-9]{4}){3}/.exec(String(advisory.url))?.[0];

const versionsOf = (advisory) =>
  [...new Set((Array.isArray(advisory.findings) ? advisory.findings : []).map((finding) => finding.version))].join(
    ", ",
  );

/** Checks every advisory against the exceptions; returns the GHSA ids seen in the report (any severity). */
function evaluate(report, exceptions, today) {
  const advisories = Object.values(report.advisories);
  const bySeverity = [...new Set(advisories.map((advisory) => String(advisory.severity)))]
    .sort((a, b) => rankOf(b) - rankOf(a))
    .map((severity) => `${String(advisories.filter((a) => String(a.severity) === severity).length)} ${severity}`);
  log(
    `pnpm audit reported ${plural(advisories.length, "advisory", "advisories")}${bySeverity.length > 0 ? ` (${bySeverity.join(", ")})` : ""}`,
  );

  const reportedGated = [...GATED].reduce(
    (sum, severity) => sum + Number(report.metadata.vulnerabilities[severity] ?? 0),
    0,
  );
  if (reportedGated > 0 && !advisories.some((advisory) => isGated(String(advisory.severity)))) {
    errors.push(`pnpm audit counts ${String(reportedGated)} high/critical vulnerabilities but lists none of them`);
  }

  const seen = new Set();
  let ungated = 0;
  for (const advisory of advisories) {
    const ghsa = ghsaOf(advisory);
    if (ghsa !== undefined) seen.add(ghsa);
    const severity = String(advisory.severity);
    if (!isGated(severity)) {
      ungated += 1;
      continue;
    }
    const subject = `${ghsa ?? `advisory ${String(advisory.id)}`} (${severity}) in ${String(advisory.module_name)}@${versionsOf(advisory)}`;
    const exception = ghsa === undefined ? undefined : exceptions.get(ghsa);
    if (exception === undefined) {
      errors.push(
        `${subject}: ${String(advisory.title)} <${String(advisory.url)}>. Upgrade or override the package, or add a justified exception to ${EXCEPTIONS}.`,
      );
    } else if (exception.expired) {
      errors.push(
        `${subject}: its exception expired on ${exception.expires}. Fix the advisory, or re-check the reason and extend the date (at most ${String(MAX_EXPIRY_DAYS)} days).`,
      );
    } else if (exception.package !== advisory.module_name) {
      errors.push(`${subject}: the exception names package "${exception.package}" instead.`);
    } else if (rankOf(severity) > rankOf(exception.severity)) {
      errors.push(`${subject}: severity rose above the "${exception.severity}" the exception was reviewed for.`);
    } else {
      log(
        `allowed ${String(ghsa)} (${severity}) in ${exception.package}@${versionsOf(advisory)}: exception expires ${exception.expires} (${plural(daysBetween(today, exception.expires), "day")} left)`,
      );
    }
  }
  if (ungated > 0) log(`${plural(ungated, "advisory", "advisories")} below high severity: reported, not gated`);
  return seen;
}

const today = todayUtc();
log(`checking pnpm-lock.yaml on ${today} (UTC)`);
const exceptions = loadExceptions(today);
rejectUnmanagedIgnores();
const report = runAudit();
const seen = report === undefined ? undefined : evaluate(report, exceptions, today);

for (const [ghsa, exception] of exceptions) {
  if (seen?.has(ghsa)) continue;
  if (exception.expired) {
    errors.push(`exception ${ghsa} (${exception.package}) expired on ${exception.expires}; delete or re-justify it.`);
  } else if (seen !== undefined) {
    warn(`exception ${ghsa} (${exception.package}) no longer matches any advisory; delete it from ${EXCEPTIONS}.`);
  }
}

if (errors.length > 0) {
  console.error(`audit: FAILED with ${plural(errors.length, "problem")}:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  log("passed: no high or critical advisory without an active exception");
}
