import { execSync } from "node:child_process";

const FALLBACK_GIT_SHA = "unknown";

export interface ResolveGitShaOptions {
  /** Defaults to `process.env`. Injectable so tests never read the real environment. */
  env?: Record<string, string | undefined>;
  /** Defaults to shelling out via `execSync`. Injectable so tests never shell out. */
  run?: (command: string) => string;
}

/**
 * Resolve the git commit SHA to embed in a Run manifest.
 *
 * Priority: `OWH_GIT_SHA` env override -> `git rev-parse --short HEAD` -> `"unknown"`.
 */
export function resolveGitSha(options: ResolveGitShaOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env.OWH_GIT_SHA;
  if (override) return override;

  const run = options.run ?? ((command: string) => execSync(command, { encoding: "utf8" }));
  try {
    const sha = run("git rev-parse --short HEAD").trim();
    return sha.length > 0 ? sha : FALLBACK_GIT_SHA;
  } catch {
    return FALLBACK_GIT_SHA;
  }
}
