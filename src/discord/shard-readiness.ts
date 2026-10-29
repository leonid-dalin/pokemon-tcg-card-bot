import { Client, Status } from "discord.js";

/**
 * Gateway readiness from the live shard set. Manager-level isReady() latches
 * after the first ready event and the manager status stays Ready while a shard
 * reconnects, and the client only emits shardDisconnect for unrecoverable codes,
 * so a normal socket close would keep publishing ready. Reading each shard's
 * current status catches a shard in Connecting or Disconnected; an empty shard
 * set is never ready.
 */
export function createShardReadiness(client: Client): () => boolean {
  return () => {
    const shards = [...client.ws.shards.values()];
    return (
      client.isReady() &&
      shards.length > 0 &&
      shards.every((shard) => shard.status === Status.Ready)
    );
  };
}
