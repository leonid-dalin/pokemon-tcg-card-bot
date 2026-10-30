import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";
import { errorCategory } from "../diagnostics.js";
import type { SettingsStore } from "../settings-store.js";

const DELETE_AFTER_MS = 90_000;
const DRAIN_INTERVAL_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;
const RETRY_BASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

type Deletion = "deleted" | "absent" | "failed";

/** Discord codes that mean the message or its channel is already gone. */
const GONE_CODES = new Set([10003, 10008, 50003]);

function isGone(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" && GONE_CODES.has(code);
}

/**
 * Deletes temporary mention-command exchanges after 90 seconds. Jobs are
 * durable in the settings database, so an outage defers the deletion instead
 * of losing it. The member's own message needs Manage Messages and a guild
 * channel; the bot's reply in a direct message needs nothing but the channel.
 */
export class CleanupWorker {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private armedAt: number | undefined;

  constructor(
    private readonly client: Client,
    private readonly store: SettingsStore,
  ) {}

  schedule(job: { botMessageId: string; channelId: string; invokeMessageId: string }): void {
    const deleteAfter = Date.now() + DELETE_AFTER_MS;
    this.store.scheduleCleanup({
      messageId: job.botMessageId,
      channelId: job.channelId,
      invokeMessageId: job.invokeMessageId,
      deleteAfter,
      attempts: 0,
    });
    this.wakeAt(deleteAfter);
  }

  /** Drains at the job's own deadline, so polling never adds a whole interval of delay. */
  private wakeAt(deadline: number): void {
    // A later deadline must not push back the timer already armed for an earlier job.
    if (this.timer && this.armedAt !== undefined && this.armedAt <= deadline) return;
    if (this.timer) clearTimeout(this.timer);
    this.armedAt = deadline;
    this.arm(deadline);
  }

  private arm(deadline: number): void {
    const wait = Math.min(Math.max(deadline - Date.now(), 0), MAX_TIMER_MS);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.armedAt = undefined;
      // Retries are scheduled only after the drain settles, so a deferred job is re-armed.
      void this.drain().finally(() => this.wakeAtNext());
    }, wait);
    this.timer.unref?.();
  }

  private wakeAtNext(): void {
    const pending = this.store.dueCleanup(Date.now());
    if (pending.length === 0 && this.armedAt !== undefined) return;
    const next = pending.length > 0
      ? Math.min(...pending.map((job) => job.deleteAfter))
      : Date.now() + DRAIN_INTERVAL_MS;
    this.armedAt = next;
    this.arm(next);
  }

  start(): void {
    // Overdue jobs from an outage are picked up as soon as the bot comes back, then
    // the single deadline timer takes over and re-arms after every drain.
    void this.drain().finally(() => this.wakeAtNext());
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.armedAt = undefined;
  }

  async drain(): Promise<void> {
    const now = Date.now();
    for (const job of this.store.dueCleanup(now)) {
      const reply = await this.deleteMessage(job.channelId, job.messageId, false);
      const invoked = await this.deleteMessage(job.channelId, job.invokeMessageId, true);
      if (reply !== "failed" && invoked !== "failed") {
        this.store.completeCleanup(job.messageId);
        continue;
      }
      // A poison job is dropped rather than blocking later work forever.
      if (job.attempts + 1 >= MAX_ATTEMPTS) {
        this.store.completeCleanup(job.messageId);
        continue;
      }
      this.store.deferCleanup(job.messageId, now + RETRY_BASE_MS * 2 ** job.attempts);
    }
  }

  private async deleteMessage(channelId: string, messageId: string, needsManage: boolean): Promise<Deletion> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return "absent";
      const direct = channel.type === ChannelType.DM;
      if (!direct) {
        if (!("permissionsFor" in channel)) return "absent";
        const permissions = channel.permissionsFor(this.client.user?.id ?? "");
        // A missing permission is not a deletion: keep the job retryable and surface it.
        if (permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) return "failed";
        if (needsManage && permissions && !permissions.has(PermissionFlagsBits.ManageMessages)) return "failed";
      } else if (needsManage) {
        // A member's direct message is their own; only the bot reply is ours to remove.
        return "absent";
      }
      const message = await channel.messages.fetch(messageId).catch((error: unknown) => {
        if (isGone(error)) return undefined;
        throw error;
      });
      if (!message) return "absent";
      await message.delete();
      return "deleted";
    } catch (error) {
      if (isGone(error)) return "absent";
      console.error(`cleanup delete failed (${errorCategory(error)})`);
      return "failed";
    }
  }
}
