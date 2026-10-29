import { MessageFlags, type Interaction } from "discord.js";
import { OverloadedError } from "../api/limiter.js";

const FAILURE = "Card lookup failed, try again.";

/** Maps an admission refusal to the hint a member can act on. */
export function overloadHint(error: unknown): number | undefined {
  return error instanceof OverloadedError ? (error.reason === "queue-full" ? 5 : 2) : undefined;
}

export function busyMessage(retryAfterSeconds: number): string {
  return `The card service is busy. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`;
}

/** Reports failure through a reply, deferred-command edit or ephemeral follow-up. */
export async function reportInteractionFailure(interaction: Interaction, error?: unknown): Promise<void> {
  if (!interaction.isRepliable()) return;
  const hint = overloadHint(error);
  const content = hint === undefined ? FAILURE : busyMessage(hint);
  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } else if (interaction.deferred && !interaction.replied && interaction.isChatInputCommand()) {
    await interaction.editReply({ content });
  } else {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  }
}
