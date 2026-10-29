import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export interface BuildIdentity {
  /** The revision the running code came from, or the package version when nothing better exists. */
  label: string;
  /** Which source produced the label, so a package version is never read as a revision. */
  source: "env" | "build" | "git" | "package";
  /** ISO date of the commit or of the bundle build, when one is known. */
  built?: string;
  /** package.json version, always reported separately from the revision. */
  packageVersion?: string;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Walks up from the module to the directory holding package.json, so source and bundle both resolve. */
function projectRoot(): string {
  let current = here;
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(current, "package.json"))) return current;
    current = dirname(current);
  }
  return here;
}

const ROOT = projectRoot();

function readPackageVersion(): string | undefined {
  try {
    const payload = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version?: string };
    return payload.version;
  } catch {
    return undefined;
  }
}

function readBuild(): { sha?: string; built?: string } {
  try {
    const payload = JSON.parse(readFileSync(join(ROOT, "BUILD.json"), "utf8")) as {
      sha?: string;
      built?: string;
    };
    return payload;
  } catch {
    return {};
  }
}

function readGit(): { sha?: string; date?: string } {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
    const date = execFileSync("git", ["log", "-1", "--format=%cI"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
    return { sha, date };
  } catch {
    return {};
  }
}

/** Resolved on first use, so a dotenv load before login still reaches BUILD_SHA. */
let identity: BuildIdentity | undefined;

/** The identity captured on first call; later checkout changes cannot alter it. */
export function buildIdentity(): BuildIdentity {
  identity ??= resolveIdentity();
  return identity;
}

/** Resolves the identity from a given environment. Exported for tests and for callers that pass their own. */
export function resolveIdentity(env: NodeJS.ProcessEnv = process.env): BuildIdentity {
  const packageVersion = readPackageVersion();
  const fromEnv = env.BUILD_SHA?.trim();
  if (fromEnv) return { label: fromEnv, source: "env", built: env.BUILD_DATE?.trim(), packageVersion };
  const build = readBuild();
  if (build.sha) return { label: build.sha, source: "build", built: build.built, packageVersion };
  if (existsSync(join(ROOT, "package.json"))) {
    const git = readGit();
    if (git.sha) return { label: git.sha, source: "git", built: git.date, packageVersion };
  }
  return { label: packageVersion ?? "unknown", source: "package", packageVersion };
}

/** Formats an elapsed millisecond count as whole days for the first week, then hours. */
export function formatUptime(elapsedMs: number): string {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const dayPart = `${days} day${days === 1 ? "" : "s"}`;
  if (days >= 7 || rest === 0) return dayPart;
  return `${dayPart} ${rest} hour${rest === 1 ? "" : "s"}`;
}
