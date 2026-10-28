import { Client, Events } from "discord.js";

/**
 * Per-shard gateway readiness. Manager-level isReady() latches after the first
 * ready event, so a shard that drops and reconnects would keep reporting ready;
 * this tracks each shard's connection state from the shard lifecycle events.
 */
export function createShardReadiness(client: Client): () => boolean {
  const connected = new Set<number>();
  client.on(Events.ShardReady, (shardId) => connected.add(shardId));
  client.on(Events.ShardResume, (shardId) => connected.add(shardId));
  client.on(Events.ShardDisconnect, (_closeEvent, shardId) => {
    connected.delete(shardId);
  });
  return () =>
    client.isReady() && client.ws.shards.size > 0 && connected.size === client.ws.shards.size;
}
