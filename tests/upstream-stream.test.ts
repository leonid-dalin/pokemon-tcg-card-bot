import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { TcgdexClient } from "../src/api/tcgdex.js";

let server: Server | undefined;

afterEach(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
});

/** Sends headers at once and the body only when the test says so. */
async function streamingServer(paths: string[]) {
  const releases = new Map<string, () => void>();
  const started: string[] = [];
  server = createServer((request, response) => {
    const name = request.url ?? "";
    started.push(name);
    response.writeHead(200, { "content-type": "application/json" });
    response.flushHeaders();
    releases.set(name, () => response.end(JSON.stringify({ id: paths.length, name })));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    started,
    release(name: string) {
      releases.get(name)?.();
    },
    releaseAll() {
      for (const release of releases.values()) release();
    },
  };
}

describe("upstream slot covers the response body", () => {
  it("keeps the third request queued while bodies are outstanding", async () => {
    const host = await streamingServer([]);
    const client = new TcgdexClient({
      baseUrl: host.baseUrl,
      retries: 0,
      limiter: { concurrency: 2, queueLimit: 5, queueWaitMs: 5000 },
    });

    const first = client.getCard("a-1");
    const second = client.getCard("a-2");
    const third = client.getCard("a-3");

    // Give the first two time to receive headers without bodies.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(host.started).toHaveLength(2);
    expect(client.queue.running).toBe(2);
    expect(client.queue.queued).toBe(1);

    host.release("/en/cards/a-1");
    await first;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(host.started).toHaveLength(3);
    expect(host.started[2]).toContain("a-3");

    host.releaseAll();
    await Promise.all([second, third]);
    expect(client.queue.running).toBe(0);
  });
});
