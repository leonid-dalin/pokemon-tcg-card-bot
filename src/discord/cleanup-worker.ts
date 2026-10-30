import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";
import { errorCategory } from "../diagnostics.js";
import type { SettingsStore } from "../settings-store.js";

const DELETE_AFTER_MS = 90_000;
const DRAIN_INTERVAL_MS = 30_000;
const RETRY_BASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

type Deletion = "deleted" | "absent" | "failed";

/** Discord codes that mean the message or its channel is already gone. */
const GONE_CODES = new Set([10003, 10008, 50001, 50003]);

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
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly client: Client,
    private readonly store: SettingsStore,
  ) {}

  schedule(job: { botMessageId: string; channelId: string; invokeMessageId: string }): void {
    this.store.scheduleCleanup({
      messageId: job.botMessageId,
      channelId: job.channelId,
      invokeMessageId: job.invokeMessageId,
      deleteAfter: Date.now() + DELETE_AFTER_MS,
      attempts: 0,
    });
  }

  start(): void {
    // Overdue jobs from an outage are picked up as soon as the bot comes back.
    void this.drain();
    this.timer = setInterval(() => {
      void this.drain();
    }, DRAIN_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
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
        if (needsManage && permissions && !permissions.has(PermissionFlagsBits.ManageMessages)) return "absent";
        if (!needsManage && permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) return "absent";
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
