import { loadConfig } from '../dist/src/config.js';

try {
  process.loadEnvFile(process.argv[2]);
  loadConfig(process.env);
  const keys = [
    'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'MENTION_ENABLED',
    'DECKLIST_ENABLED', 'MENTION_COOLDOWN_SECONDS', 'ATTRIBUTION', 'ENERGY_EMOJI',
    'INVOCATION_LOG_RETENTION_DAYS', 'INVOCATION_LOG_DIR',
  ];
  process.stdout.write(JSON.stringify(Object.fromEntries(
    keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]),
  )));
} catch {
  console.error('environment import failed; check the source file and required values');
  process.exitCode = 1;
}
