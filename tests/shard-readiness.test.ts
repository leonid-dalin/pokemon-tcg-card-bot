import { describe, expect, it } from "vitest";
import { Status } from "discord.js";
import { createShardReadiness } from "../src/discord/shard-readiness.js";

function fakeShard(status: number) {
  return { status };
}

function fakeClient(shards: Array<{ status: number }>) {
  const map = new Map(shards.map((shard, index) => [index, shard]));
  return { isReady: () => true, ws: { shards: { values: () => map.values(), size: map.size } } } as never;
}

describe("shard readiness", () => {
  it("reports not ready while a shard is reconnecting and ready again after recovery", () => {
    const client = fakeClient([fakeShard(Status.Ready)]);
    const isReady = createShardReadiness(client);
    expect(isReady()).toBe(true);
    client.ws.shards = {
      values: () => new Map([[0, fakeShard(Status.Connecting)]]).values(),
      size: 1,
    };
    expect(isReady()).toBe(false);
    client.ws.shards = {
      values: () => new Map([[0, fakeShard(Status.Disconnected)]]).values(),
      size: 1,
    };
    expect(isReady()).toBe(false);
    client.ws.shards = {
      values: () => new Map([[0, fakeShard(Status.Ready)]]).values(),
      size: 1,
    };
    expect(isReady()).toBe(true);
  });

  it("requires every shard of a sharded client", () => {
    const client = fakeClient([
      fakeShard(Status.Ready),
      fakeShard(Status.Ready),
    ]);
    const isReady = createShardReadiness(client);
    expect(isReady()).toBe(true);
    client.ws.shards = {
      values: () => new Map([[0, fakeShard(Status.Ready)], [1, fakeShard(Status.Idle)]]).values(),
      size: 2,
    };
    expect(isReady()).toBe(false);
  });

  it("never reports ready with an empty shard set", () => {
    const client = fakeClient([]);
    const isReady = createShardReadiness(client);
    expect(isReady()).toBe(false);
  });
});
