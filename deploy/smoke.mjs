import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'discord.js';
import { SettingsStore } from '../dist/src/settings-store.js';
import { textIndexSize } from '../dist/src/text-search.js';
import { getPocketCard } from '../dist/src/api/pocket.js';

const dir = mkdtempSync(join(tmpdir(), 'bot-smoke-'));
try {
  assert.equal(typeof Client, 'function');
  assert.ok(textIndexSize() > 20_000);
  assert.ok(getPocketCard('a1-036'));
  const store = new SettingsStore(join(dir, 'settings.db'), {
    messageReplies: true, decklistReplies: false, cooldownSeconds: 30,
  });
  store.update('smoke', { messageReplies: false });
  assert.equal(store.get('smoke').messageReplies, false);
  store.close();
  console.log(`offline smoke passed; RSS ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MiB`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
