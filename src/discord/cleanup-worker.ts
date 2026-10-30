import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";
import { errorCategory } from "../diagnostics.js";
import type { SettingsStore } from "../settings-store.js";

const DELETE_AFTER_MS = 90_000;
const DRAIN_INTERVAL_MS = 30_000;

/**
 * Deletes temporary mention-command exchanges after 90 seconds. Jobs are
 * durable in the settings database, so an outage defers the deletion instead
 * of losing it. The member's own message needs Manage Messages; the bot's
 * reply does not.
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
      await this.deleteMessage(job.channelId, job.messageId, false);
      await this.deleteMessage(job.channelId, job.invokeMessageId, true);
      this.store.completeCleanup(job.messageId);
    }
  }

  private async deleteMessage(channelId: string, messageId: string, needsManage: boolean): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) return;
      if (!("permissionsFor" in channel)) return;
      const permissions = channel.permissionsFor(this.client.user?.id ?? "");
      if (needsManage && permissions && !permissions.has(PermissionFlagsBits.ManageMessages)) return;
      if (!needsManage && permissions && !permissions.has(PermissionFlagsBits.ManageMessages) && !permissions.has(PermissionFlagsBits.ViewChannel)) return;
      const message = await channel.messages.fetch(messageId).catch(() => undefined);
      if (!message) return;
      await message.delete();
    } catch (error) {
      console.error(`cleanup delete failed (${errorCategory(error)})`);
    }
  }
}
