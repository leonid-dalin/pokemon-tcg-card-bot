/**
 * Load .env into process.env when the file exists. Node does the parsing, so
 * quoted values, comments and blank lines behave the same as `--env-file`.
 * A missing file is not an error: deployments usually inject real environment
 * variables and have no .env at all.
 */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // no .env, use whatever the environment provides
  }
}
