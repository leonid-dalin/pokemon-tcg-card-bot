import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface InvocationEntry {
  guildId?: string;
  channelId: string;
  isAdmin: boolean;
  trigger: string;
  reply: string;
}

interface StoredInvocation extends InvocationEntry {
  at: string;
}

export class InvocationLog {
  private readonly dir: string | undefined;
  private readonly file: string = "";
  readonly enabled: boolean;

  constructor(dir: string | undefined, private readonly retentionDays = 60, private readonly now: () => number = Date.now) {
    this.enabled = Boolean(dir);
    if (dir) {
      this.dir = dir;
      this.file = join(dir, "invocations.jsonl");
    } else {
      this.dir = undefined;
    }
  }

  record(entry: InvocationEntry): void {
    if (!this.enabled || !this.dir) return;
    const stored: StoredInvocation = { ...entry, at: new Date(this.now()).toISOString() };
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      chmodSync(this.dir, 0o700);
      appendFileSync(this.file, `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      console.warn("could not write the invocation log");
    }
  }

  prune(): void {
    if (!this.enabled || !this.dir) return;
    try {
      if (!existsSync(this.file)) return;
      const cutoff = this.now() - this.retentionDays * 86_400_000;
      const kept: string[] = [];
      for (const line of readFileSync(this.file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { at?: string };
          if (!parsed.at || Date.parse(parsed.at) < cutoff) continue;
        } catch {
          continue;
        }
        kept.push(line);
      }
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, `${kept.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      console.warn("could not prune the invocation log");
    }
  }
}
