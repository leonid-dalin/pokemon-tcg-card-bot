/** Loads an environment file into `process.env`, ignoring load errors. */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // Loading an optional environment file is best-effort.
  }
}
