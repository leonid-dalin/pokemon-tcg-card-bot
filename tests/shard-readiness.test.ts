import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { Events } from "discord.js";
import { createShardReadiness } from "../src/discord/shard-readiness.js";
import type { Client } from "discord.js";

function fakeClient(shards: number) {
  const client = new EventEmitter() as unknown as Client & { ws: { shards: { size: number } }; isReady: () => boolean };
  client.ws = { shards: { size: shards } };
  client.isReady = () => true;
  return client;
}

describe("shard readiness", () => {
  it("reports not ready while a shard is disconnected and ready again after resume", () => {
    const client = fakeClient(1);
    const isReady = createShardReadiness(client);
    expect(isReady()).toBe(false);
    client.emit(Events.ShardReady, 0);
    expect(isReady()).toBe(true);
    client.emit(Events.ShardDisconnect, { code: 1006 }, 0);
    expect(isReady()).toBe(false);
    client.emit(Events.ShardResume, 0);
    expect(isReady()).toBe(true);
  });

  it("requires every shard of a sharded client", () => {
    const client = fakeClient(2);
    const isReady = createShardReadiness(client);
    client.emit(Events.ShardReady, 0);
    expect(isReady()).toBe(false);
    client.emit(Events.ShardReady, 1);
    expect(isReady()).toBe(true);
    client.emit(Events.ShardDisconnect, { code: 1006 }, 1);
    expect(isReady()).toBe(false);
  });
});
