import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";
import { errorCategory } from "../diagnostics.js";
import type { SettingsStore } from "../settings-store.js";

const DELETE_AFTER_MS = 90_000;
const DRAIN_INTERVAL_MS = 30_000;

type Deletion = "deleted" | "absent" | "failed";

/**
 * Deletes temporary mention-command exchanges after 90 seconds. Jobs are
 * durable in the settings database, so an outage defers the deletion instead
 * of losing it. The member's own message needs Manage Messages; the bot's
 * reply does not, and a direct message needs no channel permission at all.
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
      if (reply === "failed" || invoked === "failed") continue;
      this.store.completeCleanup(job.messageId);
    }
  }

  private async deleteMessage(channelId: string, messageId: string, needsManage: boolean): Promise<Deletion> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return "absent";
      if (channel.type !== ChannelType.DM) {
        if (!("permissionsFor" in channel)) return "absent";
        const permissions = channel.permissionsFor(this.client.user?.id ?? "");
        if (needsManage && permissions && !permissions.has(PermissionFlagsBits.ManageMessages)) return "absent";
        if (!needsManage && permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) return "absent";
      }
      const message = await channel.messages.fetch(messageId).catch(() => undefined);
      if (!message) return "absent";
      await message.delete();
      return "deleted";
    } catch (error) {
      console.error(`cleanup delete failed (${errorCategory(error)})`);
      return "failed";
    }
  }
}
