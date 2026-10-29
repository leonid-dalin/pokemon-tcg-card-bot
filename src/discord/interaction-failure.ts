import { MessageFlags, type Interaction } from "discord.js";

const FAILURE = "Card lookup failed, try again.";

export function busyMessage(retryAfterSeconds: number): string {
  return `The card service is busy. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`;
}

/** Reports failure through a reply, deferred-command edit or ephemeral follow-up. */
export async function reportInteractionFailure(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content: FAILURE, flags: MessageFlags.Ephemeral });
  } else if (interaction.deferred && !interaction.replied && interaction.isChatInputCommand()) {
    await interaction.editReply({ content: FAILURE });
  } else {
    await interaction.followUp({ content: FAILURE, flags: MessageFlags.Ephemeral });
  }
}
